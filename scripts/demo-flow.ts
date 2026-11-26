import { mkdirSync, writeFileSync } from "node:fs"
import { compositeGlassesPng } from "./glasses-png"

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
  await fetch(`${api}/api/dev/reset`, { method: "POST" })

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
    messages: Array<{ text: string }>
  }
  const text = outbox.messages.at(-1)?.text ?? ""
  if (!text.includes("Short") || text.indexOf("B3") > text.indexOf("B5")) {
    throw new Error(`Report did not list the shortfall first:\n${text}`)
  }
  if (!text.includes("Variance: -5")) throw new Error(`Expected variance -5\n${text}`)
  console.log("Demo flow passed. Report:\n")
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
