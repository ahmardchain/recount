import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { cloneCatalog, LOCATIONS } from "../src/logic/catalog"
import type { AisleSheet } from "../src/logic/sheet"
import type { StockItem } from "../src/logic/types"
import { variance } from "../src/logic/variance"
import type { RecountConfig } from "./config"
import { queryLocation, updateCount } from "./notion"

export interface InventoryStore {
  locations(): Promise<string[]>
  list(location: string): Promise<StockItem[]>
  get(id: string): Promise<StockItem | null>
  writeCount(
    id: string,
    patch: { actual: number; damaged: number; counter: string; countedAt: string },
  ): Promise<{ item: StockItem; previous: StockItem }>
  restore(previous: StockItem): Promise<StockItem>
  reset(): Promise<void>
}

export interface ReportMessage {
  at: string
  text: string
  mock: boolean
  caption: string
  sheetFile: string
}

export interface OutboundReport {
  text: string
  sheet: AisleSheet
}

export interface ReportSink {
  send(report: OutboundReport): Promise<ReportMessage>
  outbox(): ReportMessage[]
  reset(): void
}

const memoryFile = () => join(process.cwd(), "data", "mock-inventory.json")
const outboxFile = () => join(process.cwd(), "data", "telegram-outbox.json")
const outboxDir = () => join(process.cwd(), "data", "outbox")

export function createStore(config: RecountConfig): InventoryStore {
  if (config.notionLive) return new NotionStore(config)
  return new MemoryStore(config.persist)
}

export function createSink(config: RecountConfig): ReportSink {
  if (config.telegramLive) return new TelegramSink(config)
  return new MemorySink(config.persist)
}

class MemoryStore implements InventoryStore {
  private items: StockItem[]

  constructor(private readonly persist: boolean) {
    this.items = this.persist ? readItems() : cloneCatalog()
  }

  async locations(): Promise<string[]> {
    return [...LOCATIONS]
  }

  async list(location: string): Promise<StockItem[]> {
    return this.items
      .filter((item) => item.location === location)
      .map((item) => ({ ...item }))
      .sort((a, b) => a.shelf.localeCompare(b.shelf))
  }

  async get(id: string): Promise<StockItem | null> {
    const item = this.items.find((row) => row.id === id)
    return item ? { ...item } : null
  }

  async writeCount(
    id: string,
    patch: { actual: number; damaged: number; counter: string; countedAt: string },
  ): Promise<{ item: StockItem; previous: StockItem }> {
    const index = this.items.findIndex((row) => row.id === id)
    const current = this.items[index]
    if (!current) throw new Error("Unknown item")
    const previous = { ...current }
    const next: StockItem = {
      ...current,
      actual: patch.actual,
      damaged: patch.damaged,
      variance: variance(patch.actual, current.expected),
      status: "Counted",
      countedAt: patch.countedAt,
      counter: patch.counter,
    }
    this.items[index] = next
    this.save()
    return { item: { ...next }, previous }
  }

  async restore(previous: StockItem): Promise<StockItem> {
    const index = this.items.findIndex((row) => row.id === previous.id)
    if (index < 0) throw new Error("Unknown item")
    this.items[index] = { ...previous }
    this.save()
    return { ...previous }
  }

  async reset(): Promise<void> {
    this.items = cloneCatalog()
    this.save()
  }

  private save(): void {
    if (!this.persist) return
    writeJson(memoryFile(), this.items)
  }
}

class NotionStore implements InventoryStore {
  private listCache = new Map<string, { at: number; items: StockItem[] }>()
  private readonly listTtlMs = 12_000

  constructor(private readonly config: RecountConfig) {}

  async locations(): Promise<string[]> {
    return [...LOCATIONS]
  }

  async list(location: string): Promise<StockItem[]> {
    const hit = this.listCache.get(location)
    if (hit && Date.now() - hit.at < this.listTtlMs) {
      return hit.items.map((item) => ({ ...item }))
    }
    const items = await queryLocation(this.config.notionToken, this.config.notionDatabaseId, location)
    this.listCache.set(location, { at: Date.now(), items })
    return items.map((item) => ({ ...item }))
  }

  private invalidateList(location?: string): void {
    if (location) this.listCache.delete(location)
    else this.listCache.clear()
  }

  async get(id: string): Promise<StockItem | null> {
    for (const location of LOCATIONS) {
      const items = await this.list(location)
      const found = items.find((item) => item.id === id)
      if (found) return found
    }
    return null
  }

  async writeCount(
    id: string,
    patch: { actual: number; damaged: number; counter: string; countedAt: string },
  ): Promise<{ item: StockItem; previous: StockItem }> {
    const previous = await this.get(id)
    if (!previous) throw new Error("Unknown item")
    const next: StockItem = {
      ...previous,
      actual: patch.actual,
      damaged: patch.damaged,
      variance: variance(patch.actual, previous.expected),
      status: "Counted",
      countedAt: patch.countedAt,
      counter: patch.counter,
    }
    await updateCount(this.config.notionToken, id, {
      actual: next.actual,
      damaged: next.damaged,
      variance: next.variance,
      status: next.status,
      countedAt: next.countedAt,
      counter: next.counter,
    })
    this.invalidateList(previous.location)
    return { item: next, previous }
  }

  async restore(previous: StockItem): Promise<StockItem> {
    await updateCount(this.config.notionToken, previous.id, {
      actual: previous.actual,
      damaged: previous.damaged,
      variance: previous.variance,
      status: previous.status,
      countedAt: previous.countedAt,
      counter: previous.counter,
    })
    this.invalidateList(previous.location)
    return { ...previous }
  }

  async reset(): Promise<void> {
    throw new Error("Reset is only available in mock mode")
  }
}

class MemorySink implements ReportSink {
  private messages: ReportMessage[]
  private delivered: ReportMessage | null = null

  constructor(private readonly persist: boolean) {
    this.messages = this.persist ? readOutbox() : []
  }

  async send(report: OutboundReport): Promise<ReportMessage> {
    if (this.delivered) return this.delivered
    let sheetFile = report.sheet.filename
    if (this.persist) {
      const path = join(outboxDir(), report.sheet.filename)
      mkdirSync(outboxDir(), { recursive: true })
      writeFileSync(path, report.sheet.bytes)
      sheetFile = path
    }
    const message: ReportMessage = {
      at: new Date().toISOString(),
      text: report.text,
      mock: true,
      caption: report.sheet.caption,
      sheetFile,
    }
    this.delivered = message
    this.messages.push(message)
    if (this.persist) writeJson(outboxFile(), this.messages)
    return message
  }

  outbox(): ReportMessage[] {
    return this.messages.map((message) => ({ ...message }))
  }

  reset(): void {
    this.messages = []
    this.delivered = null
    if (this.persist) writeJson(outboxFile(), this.messages)
  }
}

class TelegramSink implements ReportSink {
  private sent: ReportMessage | null = null
  private inflight: Promise<ReportMessage> | null = null
  private textPosted = false
  private filePosted = false
  private postedText = ""

  constructor(private readonly config: RecountConfig) {}

  async send(report: OutboundReport): Promise<ReportMessage> {
    if (this.sent) return this.sent
    if (this.inflight) return this.inflight
    this.inflight = this.post(report)
    try {
      this.sent = await this.inflight
      return this.sent
    } finally {
      this.inflight = null
    }
  }

  outbox(): ReportMessage[] {
    return this.sent ? [{ ...this.sent }] : []
  }

  reset(): void {}

  private async post(report: OutboundReport): Promise<ReportMessage> {
    if (!this.textPosted) {
      await telegram(this.config, "sendMessage", {
        chat_id: this.config.telegramChatId,
        text: report.text,
        disable_web_page_preview: true,
      })
      this.textPosted = true
      this.postedText = report.text
    }
    if (!this.filePosted) {
      const form = new FormData()
      form.set("chat_id", this.config.telegramChatId)
      form.set("caption", report.sheet.caption)
      form.set(
        "document",
        new Blob([new Uint8Array(report.sheet.bytes)], { type: report.sheet.mime }),
        report.sheet.filename,
      )
      await telegram(this.config, "sendDocument", form)
      this.filePosted = true
    }
    return {
      at: new Date().toISOString(),
      text: this.postedText,
      mock: false,
      caption: report.sheet.caption,
      sheetFile: report.sheet.filename,
    }
  }
}

async function telegram(config: RecountConfig, method: "sendMessage" | "sendDocument", body: FormData | Record<string, unknown>): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${config.telegramToken}/${method}`, {
    method: "POST",
    headers: body instanceof FormData ? undefined : { "content-type": "application/json" },
    body: body instanceof FormData ? body : JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Telegram ${response.status}: ${text.slice(0, 240)}`)
}

function readItems(): StockItem[] {
  try {
    const parsed = JSON.parse(readFileSync(memoryFile(), "utf8")) as StockItem[]
    if (Array.isArray(parsed) && parsed.length > 0) return parsed
  } catch {
    // A missing file starts a fresh shop.
  }
  const items = cloneCatalog()
  writeJson(memoryFile(), items)
  return items
}

function readOutbox(): ReportMessage[] {
  try {
    const parsed = JSON.parse(readFileSync(outboxFile(), "utf8")) as ReportMessage[]
    if (Array.isArray(parsed)) return parsed
  } catch {
    // No reports yet.
  }
  return []
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2))
}
