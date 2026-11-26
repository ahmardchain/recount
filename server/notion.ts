import type { StockItem, StockStatus } from "../src/logic/types"

const NOTION_VERSION = "2022-06-28"

interface NotionProperty {
  type?: string
  title?: Array<{ plain_text?: string }>
  rich_text?: Array<{ plain_text?: string }>
  number?: number | null
  select?: { name?: string } | null
  date?: { start?: string } | null
}

export interface NotionPage {
  id: string
  properties: Record<string, NotionProperty>
}

export async function notionFetch(
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  let last = "Notion request failed"
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`https://api.notion.com/v1${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        "notion-version": NOTION_VERSION,
        "content-type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const text = await response.text()
    if (response.ok) {
      return text ? JSON.parse(text) : {}
    }
    last = `Notion ${response.status}: ${text.slice(0, 280)}`
    if (response.status !== 429) break
    const retryAfter = Number(response.headers.get("retry-after") || "1")
    const waitMs = Math.min(20000, Math.max(1000, (Number.isFinite(retryAfter) ? retryAfter : 1) * 1000) + attempt * 500)
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
  throw new Error(last)
}

export function pageToItem(page: NotionPage): StockItem | null {
  const properties = page.properties ?? {}
  const name = readText(properties.Name)
  const location = readSelect(properties.Location)
  const shelf = readText(properties.Shelf)
  const expected = readNumber(properties.Expected)
  if (!name || !location || !shelf || expected === null) return null
  const status = readSelect(properties.Status) === "Counted" ? "Counted" : "Pending"
  return {
    id: page.id,
    location,
    shelf,
    name,
    expected,
    actual: readNumber(properties.Actual),
    damaged: readNumber(properties.Damaged),
    variance: readNumber(properties.Variance),
    status: status as StockStatus,
    countedAt: properties["Counted at"]?.date?.start ?? null,
    counter: readText(properties.Counter) || null,
  }
}

export async function queryLocation(
  token: string,
  databaseId: string,
  location: string,
): Promise<StockItem[]> {
  const items: StockItem[] = []
  let cursor: string | undefined
  do {
    const body: Record<string, unknown> = {
      filter: { property: "Location", select: { equals: location } },
      page_size: 100,
    }
    if (cursor) body.start_cursor = cursor
    const page = (await notionFetch(token, `/databases/${databaseId}/query`, {
      method: "POST",
      body,
    })) as { results?: NotionPage[]; has_more?: boolean; next_cursor?: string | null }
    for (const result of page.results ?? []) {
      const item = pageToItem(result)
      if (item) items.push(item)
    }
    cursor = page.has_more ? page.next_cursor ?? undefined : undefined
  } while (cursor)
  return items.sort((a, b) => a.shelf.localeCompare(b.shelf))
}

export async function updateCount(
  token: string,
  itemId: string,
  patch: {
    actual: number | null
    damaged: number | null
    variance: number | null
    status: StockStatus
    countedAt: string | null
    counter: string | null
  },
): Promise<void> {
  await notionFetch(token, `/pages/${itemId}`, {
    method: "PATCH",
    body: {
      properties: {
        Actual: { number: patch.actual },
        Damaged: { number: patch.damaged },
        Variance: { number: patch.variance },
        Status: { select: { name: patch.status } },
        "Counted at": patch.countedAt ? { date: { start: patch.countedAt } } : { date: null },
        Counter: {
          rich_text: patch.counter ? [{ text: { content: patch.counter.slice(0, 200) } }] : [],
        },
      },
    },
  })
}

export async function createShopDatabase(token: string, parentPageId: string): Promise<string> {
  const created = (await notionFetch(token, "/databases", {
    method: "POST",
    body: {
      parent: { type: "page_id", page_id: parentPageId },
      title: [{ type: "text", text: { content: "Shop Inventory" } }],
      properties: {
        Name: { title: {} },
        Location: {
          select: {
            options: [{ name: "Aisle B" }, { name: "Counter" }, { name: "Cold room" }],
          },
        },
        Shelf: { rich_text: {} },
        Expected: { number: { format: "number" } },
        Actual: { number: { format: "number" } },
        Variance: { number: { format: "number" } },
        Damaged: { number: { format: "number" } },
        Status: {
          select: { options: [{ name: "Pending" }, { name: "Counted" }] },
        },
        "Counted at": { date: {} },
        Counter: { rich_text: {} },
      },
    },
  })) as { id: string }
  return created.id
}

export async function createShopPage(
  token: string,
  databaseId: string,
  item: { name: string; location: string; shelf: string; expected: number },
): Promise<void> {
  await notionFetch(token, "/pages", {
    method: "POST",
    body: {
      parent: { database_id: databaseId },
      properties: {
        Name: { title: [{ text: { content: item.name } }] },
        Location: { select: { name: item.location } },
        Shelf: { rich_text: [{ text: { content: item.shelf } }] },
        Expected: { number: item.expected },
        Status: { select: { name: "Pending" } },
      },
    },
  })
}

function readText(property: NotionProperty | undefined): string {
  const parts = property?.title ?? property?.rich_text ?? []
  return parts.map((part) => part.plain_text ?? "").join("").trim()
}

function readSelect(property: NotionProperty | undefined): string {
  return property?.select?.name?.trim() ?? ""
}

function readNumber(property: NotionProperty | undefined): number | null {
  return typeof property?.number === "number" ? property.number : null
}
