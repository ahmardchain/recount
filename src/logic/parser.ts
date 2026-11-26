import type { ParsedCount } from "./types"

export interface ChatClient {
  complete(system: string, user: string): Promise<string>
}

const ONES: Record<string, number> = {
  zero: 0,
  oh: 0,
  none: 0,
  nil: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
}

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
}

const MULTIPLIERS = new Set([
  "box",
  "boxes",
  "pack",
  "packs",
  "case",
  "cases",
  "crate",
  "crates",
  "times",
  "x",
  "by",
])

const DAMAGE = new Set(["damaged", "damage", "broken", "dmg"])

const SYSTEM = [
  "You convert one spoken stock count into JSON.",
  'Reply with only a JSON object: {"actual": number, "damaged": number}.',
  "actual is how many units are on the shelf.",
  'Multiply packs. "two boxes of six" is 12.',
  "damaged is how many of those units are damaged, or 0.",
  'If there is no count, reply {"actual": null, "damaged": 0}.',
].join(" ")

export function tokenize(transcript: string): string[] {
  return transcript
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
}

function isMultiplier(token: string | undefined): boolean {
  return token !== undefined && MULTIPLIERS.has(token)
}

function readNumber(tokens: string[], index: number): { value: number; next: number } | null {
  const token = tokens[index]
  if (!token) return null
  if (/^\d+$/.test(token)) {
    const value = Number(token)
    if (value > 9999) return null
    return { value, next: index + 1 }
  }
  if (token === "dozen") return { value: 12, next: index + 1 }
  if ((token === "a" || token === "an") && tokens[index + 1] === "dozen") {
    return { value: 12, next: index + 2 }
  }
  if ((token === "a" || token === "an") && isMultiplier(tokens[index + 1])) {
    return { value: 1, next: index + 1 }
  }
  const tens = TENS[token]
  if (tens !== undefined) {
    const ones = ONES[tokens[index + 1] ?? ""]
    if (ones !== undefined && ones > 0 && ones < 10) {
      return { value: tens + ones, next: index + 2 }
    }
    return { value: tens, next: index + 1 }
  }
  const ones = ONES[token]
  if (ones !== undefined) {
    if (tokens[index + 1] === "hundred") {
      let value = ones * 100
      let next = index + 2
      if (tokens[next] === "and") next += 1
      const rest = readNumber(tokens, next)
      if (rest && rest.value < 100) return { value: value + rest.value, next: rest.next }
      return { value, next }
    }
    return { value: ones, next: index + 1 }
  }
  return null
}

export function parseCountRegex(transcript: string): { actual: number; damaged: number } | null {
  const tokens = tokenize(transcript)
  const plains: number[] = []
  let damaged = 0
  let sawNumber = false
  let index = 0

  while (index < tokens.length) {
    const read = readNumber(tokens, index)
    if (!read) {
      index += 1
      continue
    }
    sawNumber = true
    let value = read.value
    index = read.next
    if (isMultiplier(tokens[index])) {
      let multiplyAt = index + 1
      if (tokens[multiplyAt] === "of") multiplyAt += 1
      const factor = readNumber(tokens, multiplyAt)
      if (factor) {
        value *= factor.value
        index = factor.next
      }
    }
    let markedDamaged = false
    for (let look = index; look < tokens.length; look += 1) {
      if (readNumber(tokens, look)) break
      if (DAMAGE.has(tokens[look] ?? "")) {
        markedDamaged = true
        break
      }
    }
    if (markedDamaged) damaged += value
    else plains.push(value)
  }

  if (!sawNumber || plains.length === 0) return null
  const actual = plains[plains.length - 1] ?? null
  if (actual === null || !Number.isInteger(actual) || actual < 0 || actual > 9999) return null
  if (!Number.isInteger(damaged) || damaged < 0 || damaged > 9999) return null
  return { actual, damaged }
}

export function parseModelCount(raw: string): { actual: number; damaged: number } | null {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  let body: unknown
  try {
    body = JSON.parse(match[0])
  } catch {
    return null
  }
  if (!body || typeof body !== "object") return null
  const record = body as { actual?: unknown; damaged?: unknown }
  if (record.actual === null || record.actual === undefined) return null
  if (typeof record.actual !== "number" || !Number.isInteger(record.actual)) return null
  if (record.actual < 0 || record.actual > 9999) return null
  const damaged = record.damaged === undefined ? 0 : record.damaged
  if (typeof damaged !== "number" || !Number.isInteger(damaged) || damaged < 0 || damaged > 9999) {
    return null
  }
  return { actual: record.actual, damaged }
}

export async function interpretCount(
  transcript: string,
  chat: ChatClient | null,
): Promise<ParsedCount | null> {
  const trimmed = transcript.trim()
  if (!trimmed) return null
  if (chat) {
    try {
      const raw = await chat.complete(SYSTEM, trimmed)
      const parsed = parseModelCount(raw)
      if (parsed) {
        return { ...parsed, source: "llm", transcript: trimmed }
      }
    } catch {
      // The regex parser is the fallback when the model is down or unreadable.
    }
  }
  const regex = parseCountRegex(trimmed)
  if (!regex) return null
  return { ...regex, source: "regex", transcript: trimmed }
}
