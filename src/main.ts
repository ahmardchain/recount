import { waitForEvenAppBridge } from "@evenrealities/even_hub_sdk"
import { screenCopy } from "./logic/copy"
import { initialSession } from "./logic/machine"
import { RecountSession } from "./glasses/session"
import { mountStatus } from "./status"

let session: RecountSession | null = null

const status = mountStatus({
  speak(parsed) {
    session?.speak(parsed.actual, parsed.damaged)
  },
  switchLocation(location) {
    session?.switchLocation(location)
  },
})
const loading = initialSession()
status.setGlasses(loading, screenCopy(loading), false)

const bridge = await Promise.race([
  waitForEvenAppBridge(),
  new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
])

if (bridge) {
  session = new RecountSession(bridge, {
    onState(state, copy) {
      status.setGlasses(state, copy, true)
    },
  })
  try {
    const linked = await session.start()
    if (!linked) status.setGlasses(loading, screenCopy(loading), false)
  } catch (error) {
    console.error("[recount]", error instanceof Error ? error.message : error)
    status.setGlasses(loading, screenCopy(loading), false)
  }
}

window.__recount = {
  speak(transcript: string) {
    const input = document.querySelector<HTMLInputElement>("#transcript")
    if (input) input.value = transcript
    document.querySelector<HTMLFormElement>("#voice-form")?.requestSubmit()
  },
  state: () => session?.state ?? null,
}

declare global {
  interface Window {
    __recount?: {
      speak: (transcript: string) => void
      state: () => RecountSession["state"] | null
    }
  }
}
