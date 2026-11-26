import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { variance, varianceLabel } from "../src/logic/variance"

describe("variance", () => {
  it("subtracts expected from the count", () => {
    assert.equal(variance(21, 24), -3)
    assert.equal(variance(24, 24), 0)
    assert.equal(variance(30, 24), 6)
    assert.equal(variance(0, 12), -12)
  })

  it("rejects partial units", () => {
    assert.throws(() => variance(1.5, 2), /whole number/)
    assert.throws(() => variance(2, 1.5), /whole number/)
  })

  it("labels shortages before overs", () => {
    assert.equal(varianceLabel(-3), "-3 SHORT")
    assert.equal(varianceLabel(0), "0 EVEN")
    assert.equal(varianceLabel(4), "+4 OVER")
  })
})
