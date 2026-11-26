import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { cloneCatalog } from "../src/logic/catalog"
import { screenCopy } from "../src/logic/copy"
import { initialSession, reduce, tally, type CountSession, type SessionEvent } from "../src/logic/machine"
import { INPUT_DEBOUNCE_MS, UNDO_WINDOW_MS } from "../src/logic/timing"

function aisle(): CountSession {
  const items = cloneCatalog().filter((item) => item.location === "Aisle B")
  return reduce(
    initialSession(),
    { type: "loaded", items, location: "Aisle B", counter: "Ada" },
    1_000,
  ).state
}

function step(state: CountSession, event: SessionEvent, now: number) {
  return reduce(state, event, now)
}

describe("ring input", () => {
  it("debounces a repeated scroll and keeps the next one", () => {
    let state = aisle()
    assert.equal(state.count, 24)
    const first = 1_400
    state = step(state, { type: "gesture", gesture: "scroll_down" }, first).state
    assert.equal(state.count, 23)
    state = step(state, { type: "gesture", gesture: "scroll_down" }, first + INPUT_DEBOUNCE_MS - 1).state
    assert.equal(state.count, 23)
    state = step(state, { type: "gesture", gesture: "scroll_down" }, first + INPUT_DEBOUNCE_MS).state
    assert.equal(state.count, 22)
    state = step(state, { type: "gesture", gesture: "scroll_up" }, 2_200).state
    assert.equal(state.count, 23)
  })

  it("confirms in two taps, then undoes inside the window", () => {
    let state = aisle()
    let now = 2_000
    state = step(state, { type: "gesture", gesture: "scroll_down" }, now).state
    state = step(state, { type: "gesture", gesture: "scroll_down" }, now + 400).state
    state = step(state, { type: "gesture", gesture: "scroll_down" }, now + 800).state
    assert.equal(state.count, 21)

    now = 3_200
    let moved = step(state, { type: "gesture", gesture: "tap" }, now)
    assert.equal(moved.state.phase, "confirm")
    assert.deepEqual(moved.effects, [])
    const card = screenCopy(moved.state, now)
    assert.match(card.body, /21 \(-3 SHORT\)/)
    assert.match(card.hint, /Tap = Save/)

    moved = step(moved.state, { type: "gesture", gesture: "tap" }, now + INPUT_DEBOUNCE_MS - 1)
    assert.equal(moved.state.phase, "confirm")
    assert.deepEqual(moved.effects, [])

    moved = step(moved.state, { type: "gesture", gesture: "tap" }, now + 400)
    assert.equal(moved.state.phase, "saving")
    assert.equal(moved.effects[0]?.type, "commit")
    assert.deepEqual(moved.effects[0], {
      type: "commit",
      id: "b3",
      actual: 21,
      damaged: 0,
      variance: -3,
    })

    moved = step(moved.state, { type: "commit_ok", token: "undo-1" }, now + 500)
    assert.equal(moved.state.phase, "undo")
    assert.equal(moved.state.undoUntil, now + 500 + UNDO_WINDOW_MS)

    const undone = step(moved.state, { type: "gesture", gesture: "tap" }, now + 900)
    assert.equal(undone.effects[0]?.type, "revert")
    const restored = cloneCatalog().find((item) => item.id === "b3")
    assert.ok(restored)
    const back = step(undone.state, { type: "revert_ok", item: restored }, now + 1_000)
    assert.equal(back.state.phase, "counting")
    assert.equal(back.state.count, 21)
    assert.equal(back.state.items[0]?.status, "Pending")
    assert.equal(tally(back.state.results).counted, 0)
  })

  it("lets the undo window expire and moves to the next shelf", () => {
    let state = aisle()
    state = step(state, { type: "gesture", gesture: "tap" }, 5_000).state
    state = step(state, { type: "gesture", gesture: "tap" }, 5_400).state
    state = step(state, { type: "commit_ok", token: "undo-2" }, 5_500).state
    const deadline = 5_500 + UNDO_WINDOW_MS
    assert.equal(step(state, { type: "tick" }, deadline - 1).state.phase, "undo")
    const next = step(state, { type: "tick" }, deadline)
    assert.equal(next.state.phase, "counting")
    assert.equal(next.state.items[next.state.index]?.shelf, "B4")
    assert.equal(tally(next.state.results).variance, 0)
  })

  it("parses a spoken count onto the confirm card and can cancel it", () => {
    let state = aisle()
    const heard = step(state, { type: "voice", actual: 21, damaged: 2 }, 8_000)
    assert.equal(heard.state.phase, "confirm")
    assert.equal(heard.state.damaged, 2)
    assert.match(screenCopy(heard.state).body, /2 DAMAGED/)
    const cancelled = step(heard.state, { type: "gesture", gesture: "double_tap" }, 8_400)
    assert.equal(cancelled.state.phase, "counting")
    assert.equal(cancelled.state.count, 24)
    assert.equal(cancelled.state.damaged, 0)
  })

  it("counts three shelves, skips the last, and offers the report", () => {
    let state = aisle()
    let now = 10_000

    for (let i = 0; i < 3; i += 1) {
      now += 400
      state = step(state, { type: "gesture", gesture: "scroll_down" }, now).state
    }
    now += 400
    state = step(state, { type: "gesture", gesture: "tap" }, now).state
    now += 400
    state = step(state, { type: "gesture", gesture: "tap" }, now).state
    now += 100
    state = step(state, { type: "commit_ok", token: "a" }, now).state
    state = step(state, { type: "tick" }, now + UNDO_WINDOW_MS).state
    assert.equal(state.items[state.index]?.id, "b4")

    now += UNDO_WINDOW_MS + 400
    state = step(state, { type: "voice", actual: 38, damaged: 1 }, now).state
    now += 400
    state = step(state, { type: "gesture", gesture: "tap" }, now).state
    now += 100
    state = step(state, { type: "commit_ok", token: "b" }, now).state
    state = step(state, { type: "tick" }, now + UNDO_WINDOW_MS).state

    now += UNDO_WINDOW_MS + 400
    state = step(state, { type: "gesture", gesture: "tap" }, now).state
    now += 400
    state = step(state, { type: "gesture", gesture: "tap" }, now).state
    now += 100
    state = step(state, { type: "commit_ok", token: "c" }, now).state
    state = step(state, { type: "tick" }, now + UNDO_WINDOW_MS).state
    assert.equal(state.items[state.index]?.id, "b6")

    now += UNDO_WINDOW_MS + 400
    state = step(state, { type: "gesture", gesture: "double_tap" }, now).state
    assert.equal(state.phase, "summary")
    const totals = tally(state.results)
    assert.deepEqual(totals, { counted: 3, skipped: 1, variance: -5 })
    assert.match(screenCopy(state).hint, /Send report/)
    assert.match(screenCopy(aisle()).hint, /Scroll \+\/-1 · Tap -> Confirm · Dbl tap -> Skip/)

    const sending = step(state, { type: "gesture", gesture: "tap" }, now + 400)
    assert.equal(sending.effects[0]?.type, "send_report")
    const sent = step(sending.state, { type: "report_ok" }, now + 500)
    assert.equal(sent.state.phase, "sent")
    assert.equal(step(sent.state, { type: "gesture", gesture: "double_tap" }, now + 900).effects[0]?.type, "exit")
  })
})
