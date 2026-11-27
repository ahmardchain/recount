import type { IncomingMessage, ServerResponse } from "node:http"
import { createRecountRuntime } from "../server/runtime"

const runtime = createRecountRuntime({ persist: false })

export const config = {
  runtime: "nodejs",
  maxDuration: 30,
}

type NodeRequest = IncomingMessage & { body?: unknown }

export default async function handler(req: NodeRequest, res: ServerResponse): Promise<void> {
  try {
    if (req.method === "OPTIONS") {
      writeJson(res, 204, null)
      return
    }
    const url = requestUrl(req)
    const body = req.method === "GET" || req.method === "HEAD" ? {} : await readBody(req)
    const result = await runtime.handle(req.method ?? "GET", url, body)
    writeJson(res, result.status, result.body)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error"
    writeJson(res, 500, { error: message })
  }
}

function requestUrl(req: IncomingMessage): URL {
  const url = new URL(req.url ?? "/", "http://127.0.0.1")
  if (!url.pathname.startsWith("/api")) {
    url.pathname = `/api${url.pathname.startsWith("/") ? url.pathname : `/${url.pathname}`}`
  }
  return url
}

async function readBody(req: NodeRequest): Promise<unknown> {
  if (req.body !== undefined && req.body !== null && req.body !== "") {
    if (typeof req.body === "string") return JSON.parse(req.body) as unknown
    if (typeof req.body === "object") return req.body
  }
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
  return parsed
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
