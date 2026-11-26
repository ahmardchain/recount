import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
import { loadConfig } from "../server/config"
import { createSink } from "../server/store"

const original = globalThis.fetch

afterEach(() => {
  globalThis.fetch = original
})

describe("telegram sink", () => {
  it("posts one variance alert and keeps it in the outbox", async () => {
    const calls: string[] = []
    globalThis.fetch = async (input) => {
      calls.push(String(input))
      return new Response("{}", { status: 200 })
    }
    const sink = createSink(
      loadConfig({
        RECOUNT_MODE: "live",
        NOTION_TOKEN: "token",
        NOTION_DATABASE_ID: "db",
        TELEGRAM_BOT_TOKEN: "bot",
        TELEGRAM_CHAT_ID: "chat",
      }),
    )
    const first = await sink.send("Recount\nAisle B\nVariance: -5")
    const second = await sink.send("Recount\nAisle B\nVariance: -9")
    assert.equal(calls.length, 1)
    assert.match(calls[0] ?? "", /\/botbot\/sendMessage$/)
    assert.equal(first.mock, false)
    assert.equal(second.text, first.text)
    assert.equal(sink.outbox().length, 1)
  })
})
