import type { ReportRow } from "./types"

export function buildVarianceReport(input: {
  location: string
  counter: string
  counted: ReportRow[]
  skipped: number
}): string {
  const total = input.counted.reduce((sum, row) => sum + row.variance, 0)
  const shorts = input.counted
    .filter((row) => row.variance < 0)
    .sort((a, b) => a.variance - b.variance || a.shelf.localeCompare(b.shelf))
  const overs = input.counted
    .filter((row) => row.variance > 0)
    .sort((a, b) => b.variance - a.variance || a.shelf.localeCompare(b.shelf))
  const evens = input.counted
    .filter((row) => row.variance === 0)
    .sort((a, b) => a.shelf.localeCompare(b.shelf))

  const lines = [
    "Recount",
    input.location,
    `Counter: ${input.counter}`,
    `Counted: ${input.counted.length}`,
    `Skipped: ${input.skipped}`,
    `Variance: ${total}`,
  ]

  const section = (title: string, rows: ReportRow[]) => {
    if (rows.length === 0) return
    lines.push("", title)
    for (const row of rows) lines.push(formatRow(row))
  }

  section("Short", shorts)
  section("Over", overs)
  section("Even", evens)
  lines.push("")
  return lines.join("\n")
}

function formatRow(row: ReportRow): string {
  const sign = row.variance > 0 ? `+${row.variance}` : String(row.variance)
  const damaged = row.damaged > 0 ? `  damaged ${row.damaged}` : ""
  return `${row.shelf} ${row.name}  ${row.actual}/${row.expected}  (${sign})${damaged}`
}
