import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildVarianceReport } from "../src/logic/report"

describe("telegram report", () => {
  it("lists shortages before overs and evens", () => {
    const text = buildVarianceReport({
      location: "Aisle B",
      counter: "Ada",
      skipped: 1,
      counted: [
        { shelf: "B5", name: "Milk 1L", expected: 12, actual: 12, damaged: 0, variance: 0 },
        { shelf: "B4", name: "Water 75cl", expected: 40, actual: 44, damaged: 0, variance: 4 },
        { shelf: "B3", name: "Coke 50cl", expected: 24, actual: 21, damaged: 2, variance: -3 },
      ],
    })
    const shortAt = text.indexOf("Short")
    const overAt = text.indexOf("Over")
    const evenAt = text.indexOf("Even")
    assert.ok(shortAt >= 0 && shortAt < overAt && overAt < evenAt)
    assert.ok(text.indexOf("B3 Coke 50cl") < text.indexOf("B4 Water 75cl"))
    assert.match(text, /B3 Coke 50cl  21\/24  \(-3\)  damaged 2/)
    assert.match(text, /Variance: 1/)
    assert.match(text, /Skipped: 1/)
    assert.match(text, /Counter: Ada/)
  })
})
