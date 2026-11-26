export type StockStatus = "Pending" | "Counted"

export interface StockItem {
  id: string
  location: string
  shelf: string
  name: string
  expected: number
  actual: number | null
  damaged: number | null
  variance: number | null
  status: StockStatus
  countedAt: string | null
  counter: string | null
}

export interface ParsedCount {
  actual: number
  damaged: number
  source: "llm" | "regex"
  transcript: string
}

export interface ReportRow {
  shelf: string
  name: string
  expected: number
  actual: number
  damaged: number
  variance: number
}
