import { INPUT_DEBOUNCE_MS, UNDO_WINDOW_MS } from "./timing"
import type { StockItem } from "./types"
import { variance } from "./variance"

export type Phase =
  | "loading"
  | "counting"
  | "confirm"
  | "saving"
  | "undo"
  | "reverting"
  | "listening"
  | "parsing"
  | "summary"
  | "sending"
  | "sent"
  | "error"

export type Gesture =
  | "scroll_up"
  | "scroll_down"
  | "tap"
  | "double_tap"
  | "long_press"
  | "long_press_release"

export interface CountResult {
  id: string
  actual: number
  damaged: number
  variance: number
  skipped: boolean
}

export interface CountSession {
  phase: Phase
  location: string
  counter: string
  items: StockItem[]
  index: number
  count: number
  damaged: number
  savedCount: number
  savedDamaged: number
  results: CountResult[]
  undoToken: string | null
  undoUntil: number | null
  lastInputAt: number
  note: string
  error: string
}

export type Effect =
  | { type: "commit"; id: string; actual: number; damaged: number; variance: number }
  | { type: "revert"; token: string }
  | { type: "listen_start" }
  | { type: "listen_stop" }
  | { type: "listen_cancel" }
  | { type: "send_report"; location: string }
  | { type: "load"; location: string }
  | { type: "exit" }

export type SessionEvent =
  | { type: "loaded"; items: StockItem[]; location: string; counter: string }
  | { type: "load_failed"; message: string }
  | { type: "gesture"; gesture: Gesture }
  | { type: "voice"; actual: number; damaged: number }
  | { type: "voice_failed" }
  | { type: "commit_ok"; token: string }
  | { type: "commit_failed"; message: string }
  | { type: "revert_ok"; item: StockItem }
  | { type: "revert_failed"; message: string }
  | { type: "tick" }
  | { type: "report_ok" }
  | { type: "report_failed"; message: string }
  | { type: "switch_location"; location: string }
  | { type: "listen_elapsed" }

export interface Step {
  state: CountSession
  effects: Effect[]
}

export function initialSession(location = "Aisle B"): CountSession {
  return {
    phase: "loading",
    location,
    counter: "Counter",
    items: [],
    index: 0,
    count: 0,
    damaged: 0,
    savedCount: 0,
    savedDamaged: 0,
    results: [],
    undoToken: null,
    undoUntil: null,
    lastInputAt: Number.NEGATIVE_INFINITY,
    note: "",
    error: "",
  }
}

export function tally(results: CountResult[]): { counted: number; skipped: number; variance: number } {
  const counted = results.filter((result) => !result.skipped)
  return {
    counted: counted.length,
    skipped: results.length - counted.length,
    variance: counted.reduce((sum, result) => sum + result.variance, 0),
  }
}

export function currentItem(state: CountSession): StockItem | null {
  return state.items[state.index] ?? null
}

export function reduce(state: CountSession, event: SessionEvent, now: number): Step {
  switch (event.type) {
    case "loaded":
      return loadItems(state, event, now)
    case "load_failed":
      return {
        state: { ...state, phase: "error", error: clip(event.message), note: "" },
        effects: [],
      }
    case "gesture":
      return onGesture(state, event.gesture, now)
    case "voice":
      return onVoice(state, event.actual, event.damaged)
    case "voice_failed":
      if (state.phase !== "parsing" && state.phase !== "listening") return still(state)
      return {
        state: { ...state, phase: "counting", note: "No speech heard" },
        effects: [],
      }
    case "commit_ok":
      return onCommitOk(state, event.token, now)
    case "commit_failed":
      if (state.phase !== "saving") return still(state)
      return {
        state: { ...state, phase: "confirm", note: clip(event.message) || "Not saved" },
        effects: [],
      }
    case "revert_ok":
      return onRevertOk(state, event.item)
    case "revert_failed":
      if (state.phase !== "reverting") return still(state)
      if (state.undoUntil !== null && now >= state.undoUntil) return advance(state)
      return {
        state: { ...state, phase: "undo", note: clip(event.message) || "Undo failed" },
        effects: [],
      }
    case "tick":
      if (state.phase === "undo" && state.undoUntil !== null && now >= state.undoUntil) {
        return advance(state)
      }
      return still(state)
    case "report_ok":
      if (state.phase !== "sending") return still(state)
      return { state: { ...state, phase: "sent", note: "" }, effects: [] }
    case "report_failed":
      if (state.phase !== "sending") return still(state)
      return {
        state: { ...state, phase: "summary", note: clip(event.message) || "Report failed" },
        effects: [],
      }
    case "switch_location":
      return switchLocation(state, event.location)
    case "listen_elapsed":
      return finishListen(state)
    default:
      return still(state)
  }
}

function loadItems(
  state: CountSession,
  event: Extract<SessionEvent, { type: "loaded" }>,
  now: number,
): Step {
  const items = event.items.map((item) => ({ ...item }))
  const first = items[0]
  if (!first) {
    return {
      state: {
        ...state,
        phase: "summary",
        location: event.location,
        counter: event.counter,
        items,
        index: 0,
        results: [],
        note: "",
        error: "",
        undoToken: null,
        undoUntil: null,
        lastInputAt: now - INPUT_DEBOUNCE_MS,
      },
      effects: [],
    }
  }
  return {
    state: {
      ...state,
      phase: "counting",
      location: event.location,
      counter: event.counter,
      items,
      index: 0,
      count: first.expected,
      damaged: 0,
      savedCount: first.expected,
      savedDamaged: 0,
      results: [],
      undoToken: null,
      undoUntil: null,
      note: "",
      error: "",
      lastInputAt: now - INPUT_DEBOUNCE_MS,
    },
    effects: [],
  }
}

function onGesture(state: CountSession, gesture: Gesture, now: number): Step {
  if (gesture !== "long_press_release" && !acceptInput(state, now)) return still(state)
  const stamped = gesture === "long_press_release" ? state : { ...state, lastInputAt: now, note: "" }

  if (gesture === "scroll_up" || gesture === "scroll_down") {
    if (stamped.phase !== "counting" && stamped.phase !== "confirm") return still(state)
    const delta = gesture === "scroll_up" ? 1 : -1
    return {
      state: { ...stamped, count: clamp(stamped.count + delta) },
      effects: [],
    }
  }

  if (gesture === "long_press") {
    if (stamped.phase !== "counting") return still(state)
    return {
      state: {
        ...stamped,
        phase: "listening",
        savedCount: stamped.count,
        savedDamaged: stamped.damaged,
      },
      effects: [{ type: "listen_start" }],
    }
  }

  if (gesture === "long_press_release") return finishListen(stamped)

  if (gesture === "tap") return onTap(stamped)
  if (gesture === "double_tap") return onDoubleTap(stamped)
  return still(state)
}

function onTap(state: CountSession): Step {
  const item = currentItem(state)
  if (state.phase === "counting" && item) {
    return {
      state: {
        ...state,
        phase: "confirm",
        savedCount: state.count,
        savedDamaged: state.damaged,
      },
      effects: [],
    }
  }
  if (state.phase === "confirm" && item) {
    return {
      state: { ...state, phase: "saving", note: "" },
      effects: [
        {
          type: "commit",
          id: item.id,
          actual: state.count,
          damaged: state.damaged,
          variance: variance(state.count, item.expected),
        },
      ],
    }
  }
  if (state.phase === "undo" && state.undoToken) {
    return {
      state: { ...state, phase: "reverting" },
      effects: [{ type: "revert", token: state.undoToken }],
    }
  }
  if (state.phase === "summary") {
    return {
      state: { ...state, phase: "sending", note: "" },
      effects: [{ type: "send_report", location: state.location }],
    }
  }
  if (state.phase === "error") {
    return {
      state: { ...state, phase: "loading", error: "", note: "" },
      effects: [{ type: "load", location: state.location }],
    }
  }
  if (state.phase === "listening") {
    return {
      state: { ...state, phase: "counting", note: "" },
      effects: [{ type: "listen_cancel" }],
    }
  }
  return still(state)
}

function onDoubleTap(state: CountSession): Step {
  const item = currentItem(state)
  if (state.phase === "counting" && item) {
    const next: CountSession = {
      ...state,
      results: [
        ...state.results,
        { id: item.id, actual: state.count, damaged: state.damaged, variance: 0, skipped: true },
      ],
    }
    return advance(next)
  }
  if (state.phase === "confirm") {
    return {
      state: {
        ...state,
        phase: "counting",
        count: state.savedCount,
        damaged: state.savedDamaged,
        note: "",
      },
      effects: [],
    }
  }
  if (state.phase === "sent") {
    return { state, effects: [{ type: "exit" }] }
  }
  if (state.phase === "listening") {
    return {
      state: { ...state, phase: "counting", note: "" },
      effects: [{ type: "listen_cancel" }],
    }
  }
  return still(state)
}

function onVoice(state: CountSession, actual: number, damaged: number): Step {
  if (!Number.isInteger(actual) || !Number.isInteger(damaged)) return still(state)
  if (
    state.phase !== "parsing" &&
    state.phase !== "listening" &&
    state.phase !== "counting" &&
    state.phase !== "confirm"
  ) {
    return still(state)
  }
  const fromConfirm = state.phase === "confirm"
  return {
    state: {
      ...state,
      phase: "confirm",
      count: clamp(actual),
      damaged: clamp(damaged),
      savedCount: fromConfirm ? state.savedCount : state.count,
      savedDamaged: fromConfirm ? state.savedDamaged : state.damaged,
      note: "",
    },
    effects: [],
  }
}

function onCommitOk(state: CountSession, token: string, now: number): Step {
  if (state.phase !== "saving") return still(state)
  const item = currentItem(state)
  if (!item) return still(state)
  const nextVariance = variance(state.count, item.expected)
  const items = state.items.slice()
  items[state.index] = {
    ...item,
    actual: state.count,
    damaged: state.damaged,
    variance: nextVariance,
    status: "Counted",
    counter: state.counter,
    countedAt: new Date(now).toISOString(),
  }
  return {
    state: {
      ...state,
      items,
      phase: "undo",
      undoToken: token,
      undoUntil: now + UNDO_WINDOW_MS,
      note: "",
      results: [
        ...state.results,
        {
          id: item.id,
          actual: state.count,
          damaged: state.damaged,
          variance: nextVariance,
          skipped: false,
        },
      ],
    },
    effects: [],
  }
}

function onRevertOk(state: CountSession, item: StockItem): Step {
  if (state.phase !== "reverting") return still(state)
  const items = state.items.slice()
  if (items[state.index]) items[state.index] = { ...item }
  return {
    state: {
      ...state,
      items,
      phase: "counting",
      undoToken: null,
      undoUntil: null,
      note: "",
      results: state.results.filter((result) => result.id !== item.id || result.skipped),
    },
    effects: [],
  }
}

function finishListen(state: CountSession): Step {
  if (state.phase !== "listening") return still(state)
  return {
    state: { ...state, phase: "parsing" },
    effects: [{ type: "listen_stop" }],
  }
}

function switchLocation(state: CountSession, location: string): Step {
  if (
    state.phase === "saving" ||
    state.phase === "sending" ||
    state.phase === "reverting" ||
    state.phase === "parsing"
  ) {
    return still(state)
  }
  const cancel = state.phase === "listening"
  return {
    state: { ...state, phase: "loading", location, note: "", error: "" },
    effects: cancel
      ? [{ type: "listen_cancel" }, { type: "load", location }]
      : [{ type: "load", location }],
  }
}

function advance(state: CountSession): Step {
  const index = state.index + 1
  const item = state.items[index]
  if (!item) {
    return {
      state: {
        ...state,
        index,
        phase: "summary",
        undoToken: null,
        undoUntil: null,
        note: "",
      },
      effects: [],
    }
  }
  return {
    state: {
      ...state,
      index,
      phase: "counting",
      count: item.expected,
      damaged: 0,
      savedCount: item.expected,
      savedDamaged: 0,
      undoToken: null,
      undoUntil: null,
      note: "",
    },
    effects: [],
  }
}

function acceptInput(state: CountSession, now: number): boolean {
  return now - state.lastInputAt >= INPUT_DEBOUNCE_MS
}

function clamp(value: number): number {
  if (value < 0) return 0
  if (value > 999) return 999
  return value
}

function clip(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 80)
}

function still(state: CountSession): Step {
  return { state, effects: [] }
}
