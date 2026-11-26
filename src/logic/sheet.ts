const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export const SHEET_COLUMNS = [
  "Shelf",
  "Item",
  "Expected",
  "Actual",
  "Variance",
  "Damaged",
  "Status",
  "Counted at",
  "Counter",
] as const

export interface SheetItem {
  shelf: string
  name: string
  expected: number
  actual: number | null
  variance: number | null
  damaged: number | null
  status: string
  countedAt: string | null
  counter: string | null
}

export interface AisleSheet {
  filename: string
  mime: string
  bytes: Buffer
  caption: string
}

export interface SheetInput {
  location: string
  items: SheetItem[]
  now?: Date
}

type Cell = string | number | null

export function sheetCaption(location: string, now: Date): string {
  const day = now.getUTCDate()
  const month = MONTHS[now.getUTCMonth()] ?? "Jan"
  return `Recount · ${location} · ${day} ${month} ${now.getUTCFullYear()}`
}

export function sheetTotals(items: SheetItem[]): { counted: number; skipped: number; variance: number } {
  const counted = items.filter((item) => item.status === "Counted" && item.actual !== null && item.variance !== null)
  return {
    counted: counted.length,
    skipped: items.length - counted.length,
    variance: counted.reduce((sum, item) => sum + (item.variance ?? 0), 0),
  }
}

export function sheetRows(items: SheetItem[]): Cell[][] {
  const totals = sheetTotals(items)
  const rows = items.map((item) => [
    item.shelf,
    item.name,
    item.expected,
    item.actual,
    item.variance,
    item.damaged,
    item.status,
    item.countedAt,
    item.counter,
  ])
  rows.push(["Summary", `${totals.counted} counted, ${totals.skipped} skipped`, null, null, totals.variance, null, null, null, null])
  return rows
}

export async function buildAisleSheet(
  input: SheetInput,
  writeXlsx: (input: SheetInput) => Promise<AisleSheet> = buildAisleXlsx,
): Promise<AisleSheet> {
  try {
    return await writeXlsx(input)
  } catch {
    return buildAisleCsv(input)
  }
}

export async function buildAisleXlsx(input: SheetInput): Promise<AisleSheet> {
  const excel = (await import("exceljs")).default
  const now = input.now ?? new Date()
  const workbook = new excel.Workbook()
  const sheet = workbook.addWorksheet("Count")
  sheet.addRow([...SHEET_COLUMNS])
  for (const row of sheetRows(input.items)) sheet.addRow(row)
  const raw = await workbook.xlsx.writeBuffer()
  return {
    filename: filename(input.location, now, "xlsx"),
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes: Buffer.from(raw),
    caption: sheetCaption(input.location, now),
  }
}

export function buildAisleCsv(input: SheetInput): AisleSheet {
  const now = input.now ?? new Date()
  const lines = [[...SHEET_COLUMNS], ...sheetRows(input.items)].map((row) => row.map(csvCell).join(","))
  return {
    filename: filename(input.location, now, "csv"),
    mime: "text/csv",
    bytes: Buffer.from(`${lines.join("\n")}\n`, "utf8"),
    caption: sheetCaption(input.location, now),
  }
}

function filename(location: string, now: Date, ext: "xlsx" | "csv"): string {
  const slug = location.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return `recount-${slug}-${now.toISOString().slice(0, 10)}.${ext}`
}

function csvCell(value: Cell): string {
  if (value === null) return ""
  const text = String(value)
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}
