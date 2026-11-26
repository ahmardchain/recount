import assert from "node:assert/strict"
import { type AddressInfo } from "node:net"
import { after, before, describe, it } from "node:test"
import type { Server } from "node:http"
import { createRecountServer } from "../server/http"
import { pageToItem, type NotionPage } from "../server/notion"
import { pcm16leToWav } from "../src/logic/wav"

describe("mock counter service", () => {
  let server: Server
  let base: string

  before(async () => {
    const app = createRecountServer({
      env: { RECOUNT_MODE: "mock", PORT: "0" },
      persist: false,
    })
    server = app.server
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address() as AddressInfo
    base = `http://127.0.0.1:${address.port}`
  })

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  })

  it("loads an aisle, parses speech, writes, undoes, and reports shortages first", async () => {
    const health = await json("/api/health")
    assert.equal(health.notion, "mock")
    assert.equal(health.parser, "regex")

    const aisle = await json<{ items: Array<{ id: string; expected: number }> }>("/api/inventory?location=Aisle%20B")
    assert.equal(aisle.items.length, 4)
    assert.equal(aisle.items[0]?.id, "b3")

    const packs = await json<{ actual: number; source: string }>("/api/parse", {
      transcript: "two boxes of six",
    })
    assert.equal(packs.actual, 12)
    assert.equal(packs.source, "regex")

    const spoken = await json<{ actual: number; damaged: number }>("/api/parse", {
      transcript: "twenty-one, two damaged",
    })
    assert.deepEqual({ actual: spoken.actual, damaged: spoken.damaged }, { actual: 21, damaged: 2 })

    const missing = await fetch(`${base}/api/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript: "hello there" }),
    })
    assert.equal(missing.status, 422)

    const saved = await json<{ token: string; item: { variance: number; status: string } }>("/api/counts", {
      id: "b3",
      actual: 21,
      damaged: 2,
      counter: "Ada",
    })
    assert.equal(saved.item.variance, -3)
    assert.equal(saved.item.status, "Counted")

    const undone = await json<{ item: { status: string; actual: number | null } }>("/api/counts/undo", {
      token: saved.token,
    })
    assert.equal(undone.item.status, "Pending")
    assert.equal(undone.item.actual, null)

    const again = await json<{ token: string }>("/api/counts", {
      id: "b3",
      actual: 21,
      damaged: 2,
      counter: "Ada",
    })
    await json("/api/dev/expire", { token: again.token })
    const late = await fetch(`${base}/api/counts/undo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: again.token }),
    })
    assert.equal(late.status, 409)

    await json("/api/counts", { id: "b4", actual: 38, damaged: 1, counter: "Ada" })
    await json("/api/counts", { id: "b5", actual: 12, damaged: 0, counter: "Ada" })
    const report = await json<{ text: string; mock: boolean; caption: string; sheetFile: string }>("/api/report", {
      location: "Aisle B",
      counter: "Ada",
    })
    assert.equal(report.mock, true)
    assert.ok(report.text.indexOf("Short") < report.text.indexOf("Even"))
    assert.match(report.text, /B3 Coke 50cl  21\/24  \(-3\)  damaged 2/)
    assert.match(report.text, /Skipped: 1/)
    assert.match(report.caption, /^Recount · Aisle B · \d{1,2} [A-Z][a-z]{2} \d{4}$/)
    assert.match(report.sheetFile, /^recount-aisle-b-\d{4}-\d{2}-\d{2}\.xlsx$/)
    const outbox = await json<{ messages: Array<{ text: string; sheetFile: string; caption: string }> }>(
      "/api/report/outbox",
    )
    assert.equal(outbox.messages.at(-1)?.text, report.text)
    assert.equal(outbox.messages.at(-1)?.sheetFile, report.sheetFile)
    const repeat = await json<{ sheetFile: string }>("/api/report", { location: "Aisle B", counter: "Ada" })
    assert.equal(repeat.sheetFile, report.sheetFile)
    const once = await json<{ messages: Array<{ sheetFile: string }> }>("/api/report/outbox")
    assert.equal(once.messages.length, 1)

    const wav = Buffer.from(pcm16leToWav(new Uint8Array(3200))).toString("base64")
    const queued = await json("/api/dev/voice", { transcript: "twelve", wavBase64: wav })
    assert.equal(queued.queued, true)
    const taken = await json<{ transcript: string }>("/api/dev/voice")
    assert.equal(taken.transcript, "twelve")
    assert.equal((await json<{ transcript: string | null }>("/api/dev/voice")).transcript, null)
  })

  async function json<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const payload = (await response.json()) as T
    assert.equal(response.ok, true, JSON.stringify(payload))
    return payload
  }
})

describe("notion rows", () => {
  it("reads a shop inventory page", () => {
    const page: NotionPage = {
      id: "page-1",
      properties: {
        Name: { title: [{ plain_text: "Coke 50cl" }] },
        Location: { select: { name: "Aisle B" } },
        Shelf: { rich_text: [{ plain_text: "B3" }] },
        Expected: { number: 24 },
        Actual: { number: 21 },
        Variance: { number: -3 },
        Damaged: { number: 2 },
        Status: { select: { name: "Counted" } },
        "Counted at": { date: { start: "2026-11-26T12:00:00.000Z" } },
        Counter: { rich_text: [{ plain_text: "Ada" }] },
      },
    }
    const item = pageToItem(page)
    assert.equal(item?.shelf, "B3")
    assert.equal(item?.variance, -3)
    assert.equal(item?.status, "Counted")
    assert.equal(item?.counter, "Ada")
  })
})
