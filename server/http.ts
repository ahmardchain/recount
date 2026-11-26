import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { extname, join, normalize, sep } from "node:path"
import { randomUUID } from "node:crypto"
import { LOCATIONS } from "../src/logic/catalog"
import { interpretCount, type ChatClient } from "../src/logic/parser"
import { buildVarianceReport } from "../src/logic/report"
import { buildAisleSheet } from "../src/logic/sheet"
import { UNDO_GRACE_MS, UNDO_WINDOW_MS } from "../src/logic/timing"
import type { StockItem } from "../src/logic/types"
import { loadConfig, type RecountConfig } from "./config"
import { openAiChat, transcribeWav } from "./llm"
import { createSink, createStore, type InventoryStore, type ReportSink } from "./store"

interface PendingUndo {
  token: string
  previous: StockItem
  timer: NodeJS.Timeout
  open: boolean
}

export interface RecountApp {
  server: Server
  config: RecountConfig
  store: InventoryStore
  sink: ReportSink
}

export function createRecountServer(options: { env?: NodeJS.ProcessEnv; persist?: boolean } = {}): RecountApp {
  const config = loadConfig(options.env ?? process.env, { persist: options.persist })
  const store = createStore(config)
  const sink = createSink(config)
  const chat = openAiChat(config)
  const pending = new Map<string, PendingUndo>()
  let queuedVoice: { transcript?: string; wavBase64?: string } | null = null

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        writeJson(res, 204, null)
        return
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1")
      if (url.pathname.startsWith("/api/")) {
        await route(url, req, res)
        return
      }
      if (serveStatic(req, res, url.pathname)) return
      writeJson(res, 404, { error: "Not found" })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Server error"
      writeJson(res, 500, { error: message })
    }
  })

  return { server, config, store, sink }

  async function route(url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = url.pathname
    if (req.method === "GET" && path === "/api/health") {
      writeJson(res, 200, {
        ok: true,
        mode: config.mode,
        notion: config.notionLive ? "notion" : "mock",
        telegram: config.telegramLive ? "telegram" : "mock",
        parser: config.llm ? "llm" : "regex",
        stt: config.stt ? "whisper" : "none",
      })
      return
    }
    if (req.method === "GET" && path === "/api/locations") {
      writeJson(res, 200, { locations: await store.locations() })
      return
    }
    if (req.method === "GET" && path === "/api/inventory") {
      const location = url.searchParams.get("location") || "Aisle B"
      if (!isLocation(location)) {
        writeJson(res, 400, { error: "Unknown location" })
        return
      }
      writeJson(res, 200, { location, items: await store.list(location) })
      return
    }
    if (req.method === "POST" && path === "/api/counts") {
      const body = await readJson(req)
      const id = stringField(body, "id")
      const actual = numberField(body, "actual")
      const damaged = body.damaged === undefined ? 0 : numberField(body, "damaged")
      const counter = (stringField(body, "counter", true) || "Counter").replace(/[\r\n]/g, " ").slice(0, 80)
      if (!id || actual === null || damaged === null || actual < 0 || damaged < 0 || actual > 9999) {
        writeJson(res, 400, { error: "Count needs an item id and a whole number" })
        return
      }
      const written = await store.writeCount(id, {
        actual,
        damaged,
        counter,
        countedAt: new Date().toISOString(),
      })
      const token = randomUUID()
      const timer = setTimeout(() => {
        const row = pending.get(token)
        if (row) row.open = false
        pending.delete(token)
      }, UNDO_WINDOW_MS + UNDO_GRACE_MS)
      pending.set(token, { token, previous: written.previous, timer, open: true })
      writeJson(res, 200, {
        token,
        undoMs: UNDO_WINDOW_MS,
        item: written.item,
      })
      return
    }
    if (req.method === "POST" && path === "/api/counts/undo") {
      const body = await readJson(req)
      const token = stringField(body, "token")
      const row = token ? pending.get(token) : undefined
      if (!row || !row.open) {
        writeJson(res, 409, { error: "That count is already final" })
        return
      }
      clearTimeout(row.timer)
      pending.delete(token)
      const item = await store.restore(row.previous)
      writeJson(res, 200, { item })
      return
    }
    if (req.method === "POST" && path === "/api/dev/expire") {
      if (config.mode !== "mock") {
        writeJson(res, 404, { error: "Not available" })
        return
      }
      const body = await readJson(req)
      const token = stringField(body, "token")
      const row = token ? pending.get(token) : undefined
      if (!row) {
        writeJson(res, 404, { error: "Unknown token" })
        return
      }
      clearTimeout(row.timer)
      row.open = false
      pending.delete(token)
      writeJson(res, 200, { ok: true })
      return
    }
    if (req.method === "POST" && path === "/api/parse") {
      const body = await readJson(req)
      const transcript = stringField(body, "transcript")
      if (!transcript) {
        writeJson(res, 400, { error: "Missing transcript" })
        return
      }
      const parsed = await interpretCount(transcript, chat)
      if (!parsed) {
        writeJson(res, 422, { error: "Could not read a count" })
        return
      }
      writeJson(res, 200, parsed)
      return
    }
    if (req.method === "POST" && path === "/api/voice") {
      const body = await readJson(req)
      const parsed = await parseVoice(body, chat, config)
      if (!parsed) {
        writeJson(res, 422, { error: "Could not read a count from that audio" })
        return
      }
      writeJson(res, 200, parsed)
      return
    }
    if (req.method === "POST" && path === "/api/dev/voice") {
      const body = await readJson(req)
      const transcript = stringField(body, "transcript", true)
      const wavBase64 = stringField(body, "wavBase64", true)
      if (!transcript && !wavBase64) {
        writeJson(res, 400, { error: "Send a transcript or a wavBase64 file" })
        return
      }
      queuedVoice = {
        transcript: transcript || undefined,
        wavBase64: wavBase64 || undefined,
      }
      writeJson(res, 200, { queued: true })
      return
    }
    if (req.method === "GET" && path === "/api/dev/voice") {
      const queued = queuedVoice
      queuedVoice = null
      writeJson(res, 200, queued ?? { transcript: null, wavBase64: null })
      return
    }
    if (req.method === "POST" && path === "/api/report") {
      const body = await readJson(req)
      const location = stringField(body, "location") || "Aisle B"
      const counter = (stringField(body, "counter", true) || "Counter").slice(0, 80)
      if (!isLocation(location)) {
        writeJson(res, 400, { error: "Unknown location" })
        return
      }
      const items = await store.list(location)
      const counted = items
        .filter((item) => item.status === "Counted" && item.actual !== null && item.variance !== null)
        .map((item) => ({
          shelf: item.shelf,
          name: item.name,
          expected: item.expected,
          actual: item.actual ?? 0,
          damaged: item.damaged ?? 0,
          variance: item.variance ?? 0,
        }))
      const text = buildVarianceReport({
        location,
        counter,
        counted,
        skipped: items.length - counted.length,
      })
      const sheet = await buildAisleSheet({ location, items })
      const message = await sink.send({ text, sheet })
      writeJson(res, 200, {
        mock: message.mock,
        text: message.text,
        caption: message.caption,
        sheetFile: message.sheetFile,
      })
      return
    }
    if (req.method === "GET" && path === "/api/report/outbox") {
      writeJson(res, 200, { messages: sink.outbox() })
      return
    }
    if (req.method === "POST" && path === "/api/dev/reset") {
      if (config.mode !== "mock") {
        writeJson(res, 404, { error: "Reset is only available in mock mode" })
        return
      }
      for (const row of pending.values()) clearTimeout(row.timer)
      pending.clear()
      queuedVoice = null
      await store.reset()
      sink.reset()
      writeJson(res, 200, { ok: true })
      return
    }
    writeJson(res, 404, { error: "Not found" })
  }
}

async function parseVoice(
  body: JsonRecord,
  chat: ChatClient | null,
  config: RecountConfig,
): Promise<Awaited<ReturnType<typeof interpretCount>>> {
  const transcript = stringField(body, "transcript", true)
  if (transcript) return interpretCount(transcript, chat)
  const wavBase64 = stringField(body, "wavBase64", true)
  if (!wavBase64) return null
  const heard = await transcribeWav(config, wavBase64)
  if (!heard) return null
  return interpretCount(heard, chat)
}

function isLocation(value: string): boolean {
  return (LOCATIONS as readonly string[]).includes(value)
}

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false
  const root = join(process.cwd(), "dist")
  if (!existsSync(join(root, "index.html"))) return false
  const requested = pathname === "/" ? "/index.html" : pathname
  const file = normalize(join(root, decodeURIComponent(requested)))
  if (file !== root && !file.startsWith(root + sep)) return false
  const target = existsSync(file) && statSync(file).isFile() ? file : join(root, "index.html")
  const type = MIME[extname(target)] ?? "application/octet-stream"
  res.writeHead(200, { "content-type": type, "cache-control": "no-cache" })
  if (req.method === "HEAD") {
    res.end()
    return true
  }
  createReadStream(target).pipe(res)
  return true
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
}

type JsonRecord = Record<string, unknown>

function stringField(body: JsonRecord, key: string, optional = false): string {
  const value = body[key]
  if (typeof value !== "string") return optional ? "" : ""
  return value.trim()
}

function numberField(body: JsonRecord, key: string): number | null {
  const value = body[key]
  if (typeof value !== "number" || !Number.isInteger(value)) return null
  return value
}

async function readJson(req: IncomingMessage): Promise<JsonRecord> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 6_000_000) throw new Error("Body is too large")
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
  return parsed as JsonRecord
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = body === null ? "" : JSON.stringify(body)
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
  })
  res.end(payload)
}
