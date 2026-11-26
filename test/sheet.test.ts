import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildAisleCsv, buildAisleSheet, sheetCaption, type SheetItem } from "../src/logic/sheet"

const when = new Date("2026-11-26T18:00:00.000Z")

const items: SheetItem[] = [
  {
    shelf: "B3",
    name: "Coke 50cl",
    expected: 24,
    actual: 21,
    variance: -3,
    damaged: 2,
    status: "Counted",
    countedAt: "2026-11-26T12:00:00.000Z",
    counter: "Ada",
  },
  {
    shelf: "B6",
    name: "Oats 500g",
    expected: 18,
    actual: null,
    variance: null,
    damaged: null,
    status: "Pending",
    countedAt: null,
    counter: null,
  },
]

describe("aisle spreadsheet", () => {
  it("writes the aisle and a summary row", async () => {
    const sheet = await buildAisleSheet({ location: "Aisle B", items, now: when })
    assert.equal(sheet.caption, "Recount · Aisle B · 26 Nov 2026")
    assert.equal(sheetCaption("Cold room", when), "Recount · Cold room · 26 Nov 2026")
    assert.equal(sheet.filename, "recount-aisle-b-2026-11-26.xlsx")

    const excel = (await import("exceljs")).default
    const workbook = new excel.Workbook()
    await workbook.xlsx.load(sheet.bytes)
    const count = workbook.getWorksheet("Count")
    assert.ok(count)
    assert.equal(count.getRow(1).getCell(1).value, "Shelf")
    assert.equal(count.getRow(1).getCell(2).value, "Item")
    assert.equal(count.getRow(1).getCell(8).value, "Counted at")
    assert.equal(count.getRow(2).getCell(1).value, "B3")
    assert.equal(count.getRow(2).getCell(4).value, 21)
    assert.equal(count.getRow(2).getCell(5).value, -3)
    assert.equal(count.getRow(2).getCell(6).value, 2)
    assert.equal(count.getRow(2).getCell(9).value, "Ada")
    assert.equal(count.getRow(3).getCell(7).value, "Pending")
    assert.equal(count.getRow(4).getCell(1).value, "Summary")
    assert.equal(count.getRow(4).getCell(2).value, "1 counted, 1 skipped")
    assert.equal(count.getRow(4).getCell(5).value, -3)
  })

  it("falls back to csv when the workbook writer fails", async () => {
    const sheet = await buildAisleSheet({ location: "Aisle B", items, now: when }, async () => {
      throw new Error("xlsx unavailable")
    })
    assert.equal(sheet.mime, "text/csv")
    assert.equal(sheet.filename, "recount-aisle-b-2026-11-26.csv")
    const text = sheet.bytes.toString("utf8")
    assert.match(text, /^Shelf,Item,Expected,Actual,Variance,Damaged,Status,Counted at,Counter/)
    assert.match(text, /B3,Coke 50cl,24,21,-3,2,Counted,2026-11-26T12:00:00.000Z,Ada/)
    assert.match(text, /Summary,"1 counted, 1 skipped",,,-3/)
    const direct = buildAisleCsv({ location: "Aisle B", items, now: when })
    assert.equal(direct.bytes.toString("utf8"), text)
  })
})
