import { LOCATIONS } from "../src/logic/catalog"
import { interpretCount, type ChatClient } from "../src/logic/parser"
import { buildVarianceReport } from "../src/logic/report"
import { buildAisleSheet } from "../src/logic/sheet"
import { UNDO_GRACE_MS, UNDO_WINDOW_MS } from "../src/logic/timing"
import type { StockItem } from "../src/logic/types"
import { loadConfig, type RecountConfig } from "./config"
import { openAiChat, transcribeWav } from "./llm"
import { createSink, createStore, type InventoryStore, type ReportSink } from "./store"

export interface ApiResult {
  status: number
  body: unknown
}

export interface RecountRuntime {
  config: RecountConfig
  store: InventoryStore
  sink: ReportSink
  handle(method: string, url: URL, body?: unknown): Promise<ApiResult>
}

interface PendingUndo {
  token: string
  previous: StockItem
  timer: ReturnType<typeof setTimeout>
  open: boolean
}

type JsonRecord = Record<string, unknown>

export function createRecountRuntime(
  options: { env?: NodeJS.ProcessEnv; persist?: boolean } = {},
): RecountRuntime {
  const config = loadConfig(options.env ?? process.env, { persist: options.persist })
  const store = createStore(config)
  const sink = createSink(config)
  const chat = openAiChat(config)
  const pending = new Map<string, PendingUndo>()
  let queuedVoice: { transcript?: string; wavBase64?: string } | null = null
  let listening = false

  async function handle(method: string, url: URL, body: unknown = {}): Promise<ApiResult> {
    const path = url.pathname
    const jsonBody = asJson(body)

    if (method === "GET" && path === "/api/health") {
      return {
        status: 200,
        body: {
          ok: true,
          mode: config.mode,
          notion: config.notionLive ? "notion" : "mock",
          telegram: config.telegramLive ? "telegram" : "mock",
          parser: config.llm ? "llm" : "regex",
          stt: config.stt ? "whisper" : "none",
        },
      }
    }
    if (method === "GET" && path === "/api/locations") {
      return { status: 200, body: { locations: await store.locations() } }
    }
    if (method === "GET" && path === "/api/inventory") {
      const location = url.searchParams.get("location") || "Aisle B"
      if (!isLocation(location)) return { status: 400, body: { error: "Unknown location" } }
      return { status: 200, body: { location, items: await store.list(location) } }
    }
    if (method === "POST" && path === "/api/counts") {
      const id = stringField(jsonBody, "id")
      const actual = numberField(jsonBody, "actual")
      const damaged = jsonBody.damaged === undefined ? 0 : numberField(jsonBody, "damaged")
      const counter = (stringField(jsonBody, "counter", true) || "Counter").replace(/[\r\n]/g, " ").slice(0, 80)
      if (!id || actual === null || damaged === null || actual < 0 || damaged < 0 || actual > 9999) {
        return { status: 400, body: { error: "Count needs an item id and a whole number" } }
      }
      const written = await store.writeCount(id, {
        actual,
        damaged,
        counter,
        countedAt: new Date().toISOString(),
      })
      const token = crypto.randomUUID()
      const timer = setTimeout(() => {
        const row = pending.get(token)
        if (row) row.open = false
        pending.delete(token)
      }, UNDO_WINDOW_MS + UNDO_GRACE_MS)
      pending.set(token, { token, previous: written.previous, timer, open: true })
      return { status: 200, body: { token, undoMs: UNDO_WINDOW_MS, item: written.item } }
    }
    if (method === "POST" && path === "/api/counts/undo") {
      const token = stringField(jsonBody, "token")
      const row = token ? pending.get(token) : undefined
      if (!row || !row.open) return { status: 409, body: { error: "That count is already final" } }
      clearTimeout(row.timer)
      pending.delete(token)
      const item = await store.restore(row.previous)
      return { status: 200, body: { item } }
    }
    if (method === "POST" && path === "/api/dev/expire") {
      if (config.mode !== "mock") return { status: 404, body: { error: "Not available" } }
      const token = stringField(jsonBody, "token")
      const row = token ? pending.get(token) : undefined
      if (!row) return { status: 404, body: { error: "Unknown token" } }
      clearTimeout(row.timer)
      row.open = false
      pending.delete(token)
      return { status: 200, body: { ok: true } }
    }
    if (method === "POST" && path === "/api/parse") {
      const transcript = stringField(jsonBody, "transcript")
      if (!transcript) return { status: 400, body: { error: "Missing transcript" } }
      const parsed = await interpretCount(transcript, chat)
      if (!parsed) return { status: 422, body: { error: "Could not read a count" } }
      return { status: 200, body: parsed }
    }
    if (method === "POST" && path === "/api/voice") {
      const parsed = await parseVoice(jsonBody, chat, config)
      if (!parsed) return { status: 422, body: { error: "Could not read a count from that audio" } }
      return { status: 200, body: parsed }
    }
    if (method === "POST" && path === "/api/dev/voice") {
      const transcript = stringField(jsonBody, "transcript", true)
      const wavBase64 = stringField(jsonBody, "wavBase64", true)
      if (!transcript && !wavBase64) {
        return { status: 400, body: { error: "Send a transcript or a wavBase64 file" } }
      }
      queuedVoice = {
        transcript: transcript || undefined,
        wavBase64: wavBase64 || undefined,
      }
      return { status: 200, body: { queued: true } }
    }
    if (method === "GET" && path === "/api/dev/voice") {
      const queued = queuedVoice
      queuedVoice = null
      return { status: 200, body: queued ?? { transcript: null, wavBase64: null } }
    }
    if (method === "GET" && path === "/api/dev/listening") {
      return { status: 200, body: { active: listening } }
    }
    if (method === "POST" && path === "/api/dev/listening") {
      listening = jsonBody.active === true
      return { status: 200, body: { active: listening } }
    }
    if (method === "POST" && path === "/api/report") {
      const location = stringField(jsonBody, "location") || "Aisle B"
      const counter = (stringField(jsonBody, "counter", true) || "Counter").slice(0, 80)
      if (!isLocation(location)) return { status: 400, body: { error: "Unknown location" } }
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
      return {
        status: 200,
        body: {
          mock: message.mock,
          text: message.text,
          caption: message.caption,
          sheetFile: message.sheetFile,
        },
      }
    }
    if (method === "GET" && path === "/api/report/outbox") {
      return { status: 200, body: { messages: sink.outbox() } }
    }
    if (method === "POST" && path === "/api/dev/reset") {
      if (config.mode !== "mock") {
        return { status: 404, body: { error: "Reset is only available in mock mode" } }
      }
      for (const row of pending.values()) clearTimeout(row.timer)
      pending.clear()
      queuedVoice = null
      listening = false
      await store.reset()
      sink.reset()
      return { status: 200, body: { ok: true } }
    }
    return { status: 404, body: { error: "Not found" } }
  }

  return { config, store, sink, handle }
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

function asJson(body: unknown): JsonRecord {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {}
  return body as JsonRecord
}

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
