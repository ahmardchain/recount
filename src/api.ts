import type { ParsedCount, StockItem } from "./logic/types"

export interface Health {
  ok: boolean
  mode: "mock" | "live"
  notion: "notion" | "mock"
  telegram: "telegram" | "mock"
  parser: "llm" | "regex"
  stt: "whisper" | "none"
}

export interface OutboxMessage {
  at: string
  text: string
  mock: boolean
  caption?: string
  sheetFile?: string
}

async function send(path: string, body?: unknown): Promise<Response> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return response
}

async function asJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`)
  return body
}

export function getHealth(): Promise<Health> {
  return send("/api/health").then((response) => asJson<Health>(response))
}

export function getInventory(location: string): Promise<StockItem[]> {
  return send(`/api/inventory?location=${encodeURIComponent(location)}`).then(async (response) => {
    const body = await asJson<{ items: StockItem[] }>(response)
    return body.items
  })
}

export function postCount(input: {
  id: string
  actual: number
  damaged: number
  counter: string
}): Promise<{ token: string; item: StockItem }> {
  return send("/api/counts", input).then((response) => asJson(response))
}

export function postUndo(token: string): Promise<{ item: StockItem }> {
  return send("/api/counts/undo", { token }).then((response) => asJson(response))
}

export function postParse(transcript: string): Promise<ParsedCount> {
  return send("/api/parse", { transcript }).then((response) => asJson(response))
}

export function postVoice(input: { transcript?: string; wavBase64?: string }): Promise<ParsedCount> {
  return send("/api/voice", input).then((response) => asJson(response))
}

export function queueVoice(input: { transcript?: string; wavBase64?: string }): Promise<void> {
  return send("/api/dev/voice", input).then((response) => asJson(response)).then(() => undefined)
}

export function takeQueuedVoice(): Promise<{ transcript: string | null; wavBase64: string | null }> {
  return send("/api/dev/voice").then((response) => asJson(response))
}

export function postReport(
  location: string,
  counter: string,
): Promise<{ text: string; mock: boolean; caption: string; sheetFile: string }> {
  return send("/api/report", { location, counter }).then((response) => asJson(response))
}

export function getOutbox(): Promise<OutboxMessage[]> {
  return send("/api/report/outbox").then(async (response) => {
    const body = await asJson<{ messages: OutboxMessage[] }>(response)
    return body.messages
  })
}
