import { currentItem, tally, type CountSession } from "./machine"
import { variance, varianceLabel } from "./variance"

export interface ScreenCopy {
  kicker: string
  body: string
  hint: string
}

const COUNT_HINT = "Scroll +/-1 · Tap -> Confirm · Dbl tap -> Skip\nHold -> Speak"

export function screenCopy(state: CountSession, now = Date.now()): ScreenCopy {
  const item = currentItem(state)
  const place = state.location.toUpperCase()

  if (state.phase === "loading") {
    return { kicker: "RECOUNT", body: `LOADING\n${place}`, hint: "" }
  }
  if (state.phase === "error") {
    return { kicker: "RECOUNT", body: state.error || "COULD NOT LOAD", hint: "Tap -> Retry" }
  }
  if (state.phase === "listening") {
    return { kicker: "VOICE", body: "LISTENING\n\nSAY THE COUNT", hint: "Release -> Parse" }
  }
  if (state.phase === "parsing") {
    return { kicker: "VOICE", body: "READING\nTHE COUNT", hint: "" }
  }
  if (state.phase === "summary" || state.phase === "sending") {
    const totals = tally(state.results)
    const sign = totals.variance > 0 ? `+${totals.variance}` : String(totals.variance)
    return {
      kicker: place,
      body: `${place} DONE\n\n${totals.counted} COUNTED\nVARIANCE ${sign}`,
      hint: state.phase === "sending" ? "SENDING" : state.note || "Tap -> Send report",
    }
  }
  if (state.phase === "sent") {
    return {
      kicker: "SENT",
      body: "REPORT SENT\n\nSHORTFALLS ARE\nWITH THE OWNER",
      hint: "Sheet sent to Telegram\nDbl tap -> Exit",
    }
  }
  if (!item) {
    return { kicker: "RECOUNT", body: "NO ITEMS", hint: "" }
  }

  const label = varianceLabel(variance(state.count, item.expected))
  const progress = `${state.index + 1}/${state.items.length}`

  if (state.phase === "confirm" || state.phase === "saving") {
    const damaged = state.damaged > 0 ? `\n\n${state.damaged} DAMAGED` : ""
    return {
      kicker: "CONFIRM",
      body: `${state.count} (${label})${damaged}`,
      hint: state.phase === "saving" ? "SAVING" : state.note || "Tap = Save\nDbl tap = Cancel",
    }
  }
  if (state.phase === "undo" || state.phase === "reverting") {
    const left =
      state.undoUntil === null ? 3 : Math.max(1, Math.ceil((state.undoUntil - now) / 1000))
    const damaged = state.damaged > 0 ? `\n${state.damaged} DAMAGED` : ""
    return {
      kicker: "SAVED",
      body: `${state.count} (${label})${damaged}\n\nUNDO ${left}s`,
      hint: state.phase === "reverting" ? "UNDOING" : "Tap = Undo",
    }
  }

  return {
    kicker: `${place}  ${progress}`,
    body: `SHELF ${item.shelf}\n${item.name.toUpperCase()}\n\nEXPECTED  ${item.expected}\nCOUNT     ${state.count}`,
    hint: state.note || COUNT_HINT,
  }
}

export function screenLog(state: CountSession): string {
  const item = currentItem(state)
  if (item && (state.phase === "counting" || state.phase === "confirm" || state.phase === "undo")) {
    return `${state.phase} ${item.shelf}`
  }
  return state.phase
}
