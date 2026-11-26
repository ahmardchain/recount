import { getHealth, getInventory, getOutbox, postVoice, queueVoice, type Health } from "./api"
import { LOCATIONS } from "./logic/catalog"
import type { ScreenCopy } from "./logic/copy"
import { currentItem, type CountSession } from "./logic/machine"
import type { ParsedCount, StockItem } from "./logic/types"
import { bytesToBase64 } from "./logic/wav"

export interface StatusPage {
  setGlasses: (state: CountSession, copy: ScreenCopy, connected: boolean) => void
  setParse: (text: string) => void
}

export function mountStatus(actions: {
  speak: (parsed: ParsedCount) => void
  switchLocation: (location: string) => void
}): StatusPage {
  const app = document.querySelector("#app")
  if (!app) throw new Error("Missing #app")
  app.innerHTML = `
    <header class="top">
      <div>
        <p class="eyebrow">Even G2 · R1 ring</p>
        <h1>Recount</h1>
      </div>
      <p class="mode" id="mode">Checking the counter</p>
    </header>
    <p class="lede">Count a shelf without putting the box down.</p>
    <div class="layout">
      <section>
        <h2>On the glasses</h2>
        <p class="fine" id="link-state">Waiting for the Even Hub bridge.</p>
        <div class="display" aria-label="Glasses display">
          <p class="kicker" id="g-kicker"></p>
          <p class="body" id="g-body"></p>
          <p class="hint" id="g-hint"></p>
        </div>
        <p class="fine">576 × 288 monochrome. Scroll the ring, then tap to confirm.</p>
      </section>
      <section>
        <div class="section-head">
          <h2 id="aisle-title">Aisle B · inventory</h2>
          <label class="location">
            Location
            <select id="location"></select>
          </label>
        </div>
        <p class="fine" id="table-state">Loading the shelf.</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Exp</th>
                <th>Actual</th>
                <th>Var</th>
                <th>Dmg</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="rows"></tbody>
          </table>
        </div>
        <p class="fine" id="sync"></p>
      </section>
    </div>
    <section class="voice">
      <h2>Voice, for the simulator</h2>
      <p class="fine">The simulator microphone is unreliable. Paste a transcript or a WAV. The count still waits for a tap before it is written.</p>
      <form id="voice-form">
        <label>
          Transcript
          <input id="transcript" name="transcript" type="text" placeholder="twenty-one, two damaged" autocomplete="off" />
        </label>
        <label>
          WAV file
          <input id="wav" name="wav" type="file" accept="audio/wav,.wav" />
        </label>
        <div class="actions">
          <button type="submit">Show confirm card</button>
          <button type="button" id="queue">Queue for hold to speak</button>
        </div>
      </form>
      <p class="parse" id="parse"></p>
    </section>
    <section>
      <h2>Telegram</h2>
      <pre class="report" id="report">No report yet.</pre>
    </section>
  `

  const locationSelect = required<HTMLSelectElement>("#location")
  for (const location of LOCATIONS) {
    const option = document.createElement("option")
    option.value = location
    option.textContent = location
    locationSelect.append(option)
  }

  const transcript = required<HTMLInputElement>("#transcript")
  const wav = required<HTMLInputElement>("#wav")
  const form = required<HTMLFormElement>("#voice-form")
  let glasses = false
  let activeId: string | null = null

  form.addEventListener("submit", (event) => {
    event.preventDefault()
    void runVoice(false)
  })
  required<HTMLButtonElement>("#queue").addEventListener("click", () => {
    void runVoice(true)
  })
  locationSelect.addEventListener("change", () => {
    actions.switchLocation(locationSelect.value)
    void refreshTable(locationSelect.value, activeId)
  })

  void pollHealth()
  void refreshTable(locationSelect.value, null)
  void refreshOutbox()
  setInterval(() => {
    void refreshTable(locationSelect.value, activeId)
    void refreshOutbox()
  }, 2000)

  return {
    setGlasses(state, copy, connected) {
      glasses = connected
      required("#link-state").textContent = connected
        ? "Linked to the glasses page."
        : "Open this page in evenhub-simulator to drive the glasses."
      required("#g-kicker").textContent = connected ? copy.kicker : "RECOUNT"
      required("#g-body").textContent = connected ? copy.body : "WAITING FOR\nTHE SIMULATOR"
      required("#g-hint").textContent = connected ? copy.hint : ""
      const item = currentItem(state)
      activeId = item?.id ?? null
      if (locationSelect.value !== state.location && document.activeElement !== locationSelect) {
        locationSelect.value = state.location
      }
      required("#aisle-title").textContent = `${state.location} · inventory`
      void refreshTable(state.location, activeId)
    },
    setParse(text) {
      required("#parse").textContent = text
    },
  }

  async function runVoice(queue: boolean): Promise<void> {
    const said = transcript.value.trim()
    const file = wav.files?.[0]
    const parse = required("#parse")
    if (!said && !file) {
      parse.textContent = "Type a count or choose a WAV."
      return
    }
    try {
      const wavBase64 = file ? bytesToBase64(new Uint8Array(await file.arrayBuffer())) : undefined
      if (queue) {
        await queueVoice({ transcript: said || undefined, wavBase64 })
        parse.textContent = "Queued. Hold the ring, then release."
        return
      }
      const parsed = await postVoice({ transcript: said || undefined, wavBase64 })
      parse.textContent = `actual ${parsed.actual} · damaged ${parsed.damaged} · ${parsed.source}`
      if (glasses) actions.speak(parsed)
      else parse.textContent += ". The glasses page is not linked, so this stayed on the server."
    } catch (error) {
      parse.textContent = error instanceof Error ? error.message : "Could not read that count"
    }
  }
}

async function pollHealth(): Promise<void> {
  try {
    const health = await getHealth()
    required("#mode").textContent = modeLine(health)
  } catch {
    required("#mode").textContent = "Counter service is not running"
  }
}

async function refreshTable(location: string, activeId: string | null): Promise<void> {
  const body = required("#rows")
  const state = required("#table-state")
  try {
    const items = await getInventory(location)
    body.replaceChildren()
    if (items.length === 0) {
      state.textContent = "This location has no rows."
      required("#sync").textContent = ""
      return
    }
    state.textContent = ""
    for (const item of items) body.append(row(item, item.id === activeId))
    const counted = items.filter((item) => item.status === "Counted").length
    required("#sync").textContent = `Synced ${counted} / ${items.length}`
  } catch (error) {
    state.textContent = error instanceof Error ? error.message : "Could not load the shelf"
  }
}

async function refreshOutbox(): Promise<void> {
  try {
    const messages = await getOutbox()
    const latest = messages[messages.length - 1]
    required("#report").textContent = latest
      ? latest.caption
        ? `${latest.text}\n\n${latest.caption}\n${latest.sheetFile ?? ""}`
        : latest.text
      : "No report yet."
  } catch {
    // The table already shows when the service is down.
  }
}

function row(item: StockItem, active: boolean): HTMLTableRowElement {
  const tr = document.createElement("tr")
  if (active) tr.className = "active"
  const cells = [
    `${item.shelf} · ${item.name}`,
    String(item.expected),
    item.actual === null ? "—" : String(item.actual),
    item.variance === null ? "—" : String(item.variance),
    item.damaged === null ? "—" : String(item.damaged),
    item.status,
  ]
  for (const value of cells) {
    const td = document.createElement("td")
    td.textContent = value
    tr.append(td)
  }
  return tr
}

function modeLine(health: Health): string {
  const notion = health.notion === "notion" ? "Notion" : "Mock shelf"
  const telegram = health.telegram === "telegram" ? "Telegram" : "Mock Telegram"
  const parser = health.parser === "llm" ? "LLM parser" : "Regex parser"
  return `${notion} · ${telegram} · ${parser}`
}

function required<T extends Element>(selector: string): T {
  const node = document.querySelector(selector)
  if (!node) throw new Error(`Missing ${selector}`)
  return node as T
}
