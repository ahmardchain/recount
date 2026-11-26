import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import { loadConfig, liveNotionSource } from "../server/config"
import { applyEnvFile } from "../server/envfile"

describe("live notion source", () => {
  it("creates under the parent page only when the database id is empty", () => {
    const parent = loadConfig({
      RECOUNT_MODE: "live",
      NOTION_TOKEN: "token",
      NOTION_PARENT_PAGE_ID: "page",
      TELEGRAM_BOT_TOKEN: "bot",
      TELEGRAM_CHAT_ID: "chat",
    })
    assert.equal(liveNotionSource(parent), "parent")
    assert.equal(parent.telegramLive, true)
    assert.equal(parent.notionLive, false)

    const existing = loadConfig({
      RECOUNT_MODE: "live",
      NOTION_TOKEN: "token",
      NOTION_DATABASE_ID: "db",
      NOTION_PARENT_PAGE_ID: "page",
    })
    assert.equal(liveNotionSource(existing), "database")
    assert.equal(existing.notionLive, true)
    assert.equal(liveNotionSource(loadConfig({ RECOUNT_MODE: "live" })), "missing")
  })

  it("does not override variables that are already set", () => {
    const dir = mkdtempSync(join(tmpdir(), "recount-env-"))
    const path = join(dir, ".env")
    writeFileSync(path, "RECOUNT_MODE=live\nNOTION_PARENT_PAGE_ID=from-file\nTELEGRAM_CHAT_ID=from-file\n")
    const previousMode = process.env.RECOUNT_MODE
    const previousPage = process.env.NOTION_PARENT_PAGE_ID
    const previousChat = process.env.TELEGRAM_CHAT_ID
    process.env.RECOUNT_MODE = "mock"
    delete process.env.NOTION_PARENT_PAGE_ID
    delete process.env.TELEGRAM_CHAT_ID
    try {
      applyEnvFile(path)
      assert.equal(process.env.RECOUNT_MODE, "mock")
      assert.equal(process.env.NOTION_PARENT_PAGE_ID, "from-file")
      assert.equal(process.env.TELEGRAM_CHAT_ID, "from-file")
    } finally {
      restore("RECOUNT_MODE", previousMode)
      restore("NOTION_PARENT_PAGE_ID", previousPage)
      restore("TELEGRAM_CHAT_ID", previousChat)
    }
  })
})

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}
