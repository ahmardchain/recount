import { mkdirSync, writeFileSync } from "node:fs"
import { applyEnvFile } from "../server/envfile"
import { compositeGlassesPng } from "./glasses-png"

applyEnvFile()

const api = "http://127.0.0.1:4187"
const sim = "http://127.0.0.1:9898"
const screens = "docs/screens"

interface ConsoleEntry {
  id: number
  message?: string
  args?: unknown[]
}

async function main(): Promise<void> {
  mkdirSync(screens, { recursive: true })
  const deadline = Date.now() + 20000
  let up = false
  while (Date.now() < deadline) {
    try {
      const ping = await fetch(`${sim}/api/ping`)
      if (ping.ok) {
        up = true
        break
      }
    } catch {
      // The simulator process is still booting.
    }
    await sleep(200)
  }
  if (!up) throw new Error("Simulator automation port is not up")

  const healthResponse = await fetch(`${api}/api/health`)
  if (!healthResponse.ok) throw new Error("Recount API is not up. Start it with npm run dev.")
  const health = (await healthResponse.json()) as {
    mode?: string
    notion?: string
    telegram?: string
  }
  const live = health.mode === "live"
  if (process.env.RECOUNT_MODE === "live" && !live) {
    throw new Error("RECOUNT_MODE=live but the API is still mock. Restart npm run dev so it reloads .env.")
  }
  if (live && (health.notion !== "notion" || health.telegram !== "telegram")) {
    throw new Error("Live demo needs Notion and Telegram. Set NOTION_TOKEN, NOTION_PARENT_PAGE_ID or NOTION_DATABASE_ID, TELEGRAM_BOT_TOKEN, and TELEGRAM_CHAT_ID.")
  }
  if (!live) {
    const reset = await fetch(`${api}/api/dev/reset`, { method: "POST" })
    if (!reset.ok) throw new Error(`Could not reset the mock shop (${reset.status})`)
  }

  let since = 0
  await waitFor("screen loading", 20000)
  await shot("01-loading.png")
  await waitFor("screen counting B3", 15000)
  await shot("02-item.png")

  for (let i = 0; i < 3; i += 1) await press("down")
  await shot("03-adjusted.png")
  await press("click")
  await waitFor("screen confirm B3")
  await shot("04-confirm.png")
  await press("click")
  await waitFor("screen undo B3")
  await shot("05-undo.png")
  await waitFor("screen counting B4", 8000)

  const queued = await fetch(`${api}/api/dev/voice`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transcript: "thirty-eight, one damaged" }),
  })
  if (!queued.ok) throw new Error(`Could not queue voice (${queued.status})`)
  await press("long_press", 150)
  await waitFor("screen listening")
  await shot("06-listening.png")
  await press("long_press_release", 150)
  await waitFor("screen confirm B4")
  await shot("07-voice-confirm.png")
  await sleep(400)
  await press("click")
  await waitFor("screen undo B4")
  await waitFor("screen counting B5", 8000)

  await press("click")
  await waitFor("screen confirm B5")
  await press("click")
  await waitFor("screen undo B5")
  await waitFor("screen counting B6", 8000)
  await press("double_click")
  await waitFor("screen summary")
  await shot("08-summary.png")
  await press("click")
  await waitFor("screen sent")
  await shot("09-sent.png")

  const outbox = (await (await fetch(`${api}/api/report/outbox`)).json()) as {
    messages: Array<{ text: string; mock: boolean; sheetFile?: string }>
  }
  if (live && outbox.messages.length !== 1) {
    throw new Error(`Expected one Telegram alert, saw ${outbox.messages.length}`)
  }
  const message = outbox.messages.at(-1)
  const text = message?.text ?? ""
  if (!message?.sheetFile) throw new Error("Report did not include a spreadsheet")
  if (live && message?.mock !== false) throw new Error("Report stayed in the mock outbox")
  if (!text.includes("Short") || text.indexOf("B3") > text.indexOf("B5")) {
    throw new Error(`Report did not list the shortfall first:\n${text}`)
  }
  if (!text.includes("Variance: -5")) throw new Error(`Expected variance -5\n${text}`)
  console.log(live ? "Live demo passed. One Telegram alert:\n" : "Demo flow passed. Report:\n")
  console.log(text)

  async function press(action: string, settle = 450): Promise<void> {
    const response = await fetch(`${sim}/api/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    })
    if (!response.ok) throw new Error(`${action} -> ${response.status} ${await response.text()}`)
    await sleep(settle)
  }

  async function shot(name: string): Promise<void> {
    const response = await fetch(`${sim}/api/screenshot/glasses`)
    if (!response.ok) throw new Error(`screenshot ${name} -> ${response.status}`)
    const bytes = compositeGlassesPng(Buffer.from(await response.arrayBuffer()))
    writeFileSync(`${screens}/${name}`, bytes)
    console.log(`saved ${screens}/${name} (${bytes.length} bytes)`)
  }

  async function waitFor(fragment: string, timeout = 10000): Promise<void> {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const data = (await (await fetch(`${sim}/api/console?since_id=${since}`)).json()) as {
        entries?: ConsoleEntry[]
      }
      for (const entry of data.entries ?? []) {
        since = Math.max(since, entry.id ?? 0)
        const message = entry.message ?? JSON.stringify(entry.args ?? entry)
        if (message.includes(fragment)) return
      }
      await sleep(200)
    }
    const recent = await (await fetch(`${sim}/api/console`)).text()
    throw new Error(`Timed out waiting for ${fragment}\n${recent.slice(-2000)}`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
