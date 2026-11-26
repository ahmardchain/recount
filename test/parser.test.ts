import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { interpretCount, parseCountRegex, type ChatClient } from "../src/logic/parser"

describe("count parser", () => {
  it("reads digits, words, packs, and damage", () => {
    assert.deepEqual(parseCountRegex("12"), { actual: 12, damaged: 0 })
    assert.deepEqual(parseCountRegex("twelve"), { actual: 12, damaged: 0 })
    assert.deepEqual(parseCountRegex("two boxes of six"), { actual: 12, damaged: 0 })
    assert.deepEqual(parseCountRegex("2 boxes of 6"), { actual: 12, damaged: 0 })
    assert.deepEqual(parseCountRegex("three packs of four"), { actual: 12, damaged: 0 })
    assert.deepEqual(parseCountRegex("twenty-one, two damaged"), { actual: 21, damaged: 2 })
    assert.deepEqual(parseCountRegex("thirty eight, one damaged"), { actual: 38, damaged: 1 })
    assert.deepEqual(parseCountRegex("a dozen"), { actual: 12, damaged: 0 })
    assert.deepEqual(parseCountRegex("none"), { actual: 0, damaged: 0 })
    assert.equal(parseCountRegex(""), null)
    assert.equal(parseCountRegex("no idea"), null)
  })

  it("prefers a valid model reply and falls back when it is unusable", async () => {
    const chat: ChatClient = {
      async complete() {
        return '```json\n{"actual":18,"damaged":1}\n```'
      },
    }
    const parsed = await interpretCount("twelve", chat)
    assert.deepEqual(parsed, { actual: 18, damaged: 1, source: "llm", transcript: "twelve" })

    const broken: ChatClient = {
      async complete() {
        return "I think it was twelve"
      },
    }
    const fallback = await interpretCount("twelve", broken)
    assert.equal(fallback?.source, "regex")
    assert.equal(fallback?.actual, 12)

    const down: ChatClient = {
      async complete() {
        throw new Error("offline")
      },
    }
    const still = await interpretCount("two boxes of six", down)
    assert.equal(still?.actual, 12)
    assert.equal(still?.source, "regex")

    const empty: ChatClient = {
      async complete() {
        return '{"actual":null,"damaged":0}'
      },
    }
    assert.equal(await interpretCount("nope", empty), null)
  })
})
