import { createRecountRuntime } from "./runtime"

const runtime = createRecountRuntime({ persist: false })

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS })
    }
    try {
      const url = new URL(request.url)
      if (!url.pathname.startsWith("/api/")) {
        return json(404, { error: "Not found" })
      }
      let body: unknown = {}
      if (request.method !== "GET" && request.method !== "HEAD") {
        const text = await request.text()
        if (text) body = JSON.parse(text) as unknown
      }
      const result = await runtime.handle(request.method, url, body)
      return json(result.status, result.body)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Server error"
      return json(500, { error: message })
    }
  },
}

function json(status: number, body: unknown): Response {
  return new Response(status === 204 || body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS,
    },
  })
}
