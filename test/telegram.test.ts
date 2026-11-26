import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, it } from "node:test"
import { loadConfig } from "../server/config"
import { createSink, type OutboundReport } from "../server/store"
import type { AisleSheet } from "../src/logic/sheet"

const original = globalThis.fetch

afterEach(() => {
  globalThis.fetch = original
})

const sheet: AisleSheet = {
  filename: "recount-aisle-b-2026-11-26.xlsx",
  mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  bytes: Buffer.from("workbook"),
  caption: "Recount · Aisle B · 26 Nov 2026",
}

function report(text: string): OutboundReport {
  return { text, sheet }
}

describe("telegram sink", () => {
  it("posts one text alert and one spreadsheet", async () => {
    const calls: string[] = []
    let caption = ""
    let filename = ""
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      calls.push(url)
      if (init?.body instanceof FormData) {
        caption = String(init.body.get("caption"))
        const file = init.body.get("document")
        if (file instanceof File) filename = file.name
      }
      return new Response("{}", { status: 200 })
    }
    const sink = createSink(liveConfig())
    const first = await sink.send(report("Recount\nAisle B\nVariance: -5"))
    const second = await sink.send(report("Recount\nAisle B\nVariance: -9"))
    assert.deepEqual(
      calls.map((url) => url.slice(url.lastIndexOf("/") + 1)),
      ["sendMessage", "sendDocument"],
    )
    assert.equal(caption, "Recount · Aisle B · 26 Nov 2026")
    assert.equal(filename, sheet.filename)
    assert.equal(first.mock, false)
    assert.equal(second.text, first.text)
    assert.equal(second.sheetFile, sheet.filename)
    assert.equal(sink.outbox().length, 1)
  })

  it("retries the file without posting the text again", async () => {
    const calls: string[] = []
    let documents = 0
    globalThis.fetch = async (input) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith("sendDocument")) {
        documents += 1
        if (documents === 1) return new Response("no", { status: 400 })
      }
      return new Response("{}", { status: 200 })
    }
    const sink = createSink(liveConfig())
    await assert.rejects(() => sink.send(report("first text")))
    const sent = await sink.send(report("second text"))
    assert.equal(sent.text, "first text")
    assert.equal(calls.filter((url) => url.endsWith("sendMessage")).length, 1)
    assert.equal(calls.filter((url) => url.endsWith("sendDocument")).length, 2)
    await sink.send(report("third text"))
    assert.equal(calls.length, 3)
  })
})

describe("mock outbox", () => {
  it("writes one spreadsheet into the outbox directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recount-outbox-"))
    const previous = process.cwd()
    process.chdir(dir)
    try {
      const sink = createSink(loadConfig({ RECOUNT_MODE: "mock" }, { persist: true }))
      const message = await sink.send(report("Recount\nAisle B"))
      const bytes = readFileSync(message.sheetFile)
      assert.equal(bytes.toString("utf8"), "workbook")
      assert.match(message.sheetFile, /data\/outbox\/recount-aisle-b-2026-11-26\.xlsx$/)
      const second = await sink.send(report("again"))
      assert.equal(second.text, message.text)
      assert.equal(sink.outbox().length, 1)
    } finally {
      process.chdir(previous)
    }
  })
})

function liveConfig() {
  return loadConfig({
    RECOUNT_MODE: "live",
    NOTION_TOKEN: "token",
    NOTION_DATABASE_ID: "db",
    TELEGRAM_BOT_TOKEN: "bot",
    TELEGRAM_CHAT_ID: "chat",
  })
}
