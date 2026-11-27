import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { extname, join, normalize, sep } from "node:path"
import { createRecountRuntime, type RecountRuntime } from "./runtime"

export interface RecountApp extends RecountRuntime {
  server: Server
}

export function createRecountServer(options: { env?: NodeJS.ProcessEnv; persist?: boolean } = {}): RecountApp {
  const runtime = createRecountRuntime(options)
  const server = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        writeJson(res, 204, null)
        return
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1")
      if (url.pathname.startsWith("/api/")) {
        const body = req.method === "GET" || req.method === "HEAD" ? {} : await readJson(req)
        const result = await runtime.handle(req.method ?? "GET", url, body)
        writeJson(res, result.status, result.body)
        return
      }
      if (serveStatic(req, res, url.pathname)) return
      writeJson(res, 404, { error: "Not found" })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Server error"
      writeJson(res, 500, { error: message })
    }
  })
  return { server, ...runtime }
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
