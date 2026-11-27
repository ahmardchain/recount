import {
  AudioInputSource,
  CreateStartUpPageContainer,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
  type EvenHubEvent,
} from "@evenrealities/even_hub_sdk"
import { getInventory, postCount, postReport, postUndo, postVoice, setListening, takeQueuedVoice } from "../api"
import { screenCopy, screenLog, type ScreenCopy } from "../logic/copy"
import {
  initialSession,
  reduce,
  type CountSession,
  type Effect,
  type Gesture,
  type SessionEvent,
} from "../logic/machine"
import { LISTEN_WINDOW_MS } from "../logic/timing"
import { bytesToBase64, pcm16leToWav } from "../logic/wav"

const LOCATIONS: Record<number, string> = {
  1: "Aisle B",
  2: "Counter",
  3: "Cold room",
}

export interface RecountHooks {
  onState: (state: CountSession, copy: ScreenCopy) => void
}

export class RecountSession {
  state: CountSession = initialSession()
  private queue: Promise<void> = Promise.resolve()
  private painted: ScreenCopy = { kicker: "", body: "", hint: "" }
  private logged = ""
  private pcm: Uint8Array[] = []
  private listenTimer: ReturnType<typeof setTimeout> | null = null
  private loadGeneration = 0
  private counter = "Counter"

  constructor(
    private readonly bridge: EvenAppBridge,
    private readonly hooks: RecountHooks,
  ) {}

  async start(): Promise<boolean> {
    const page = new CreateStartUpPageContainer({
      containerTotalNum: 3,
      textObject: [
        container(1, "kicker", 8, 36, "RECOUNT", 2, 0, 1),
        container(2, "body", 48, 150, "LOADING\nAISLE B", 4, 1, 2),
        container(3, "hint", 206, 74, "", 2, 0, 3),
      ],
      menuObject: new MenuContainerProperty({
        menuItems: [
          new MenuItemProperty({ itemName: "Aisle B", itemID: 1 }),
          new MenuItemProperty({ itemName: "Counter", itemID: 2 }),
          new MenuItemProperty({ itemName: "Cold room", itemID: 3 }),
          new MenuItemProperty({ itemName: "Speak", itemID: 4 }),
        ],
      }),
    })
    const created = await this.bridge.createStartUpPageContainer(page)
    if (created !== StartUpPageCreateResult.success) {
      console.warn(`[recount] glasses display unavailable (${created})`)
      return false
    }
    console.log("[recount] ready")
    this.bridge.onEvenHubEvent((event) => {
      this.onHubEvent(event)
    })
    setInterval(() => this.push({ type: "tick" }), 250)
    this.render()
    if (new URLSearchParams(location.search).has("demo")) {
      await sleep(2500)
    }
    try {
      const user = await Promise.race([
        this.bridge.getUserInfo(),
        sleep(500).then(() => null),
      ])
      if (user?.name) this.counter = user.name.slice(0, 40)
    } catch {
      // The simulator may not have a wearer profile. The count still stands.
    }
    await this.load(this.state.location)
    return true
  }

  speak(actual: number, damaged: number): void {
    this.push({ type: "voice", actual, damaged })
  }

  switchLocation(next: string): void {
    this.push({ type: "switch_location", location: next })
  }

  private onHubEvent(event: EvenHubEvent): void {
    const menuId = event.menuItemClickEvent?.itemID
    if (menuId) {
      if (menuId === 4) this.push({ type: "gesture", gesture: "long_press" })
      const location = LOCATIONS[menuId]
      if (location) this.push({ type: "switch_location", location })
      return
    }
    const text = event.textEvent
    if (text && text.containerName === "body") {
      const gesture = gestureFromText(text.eventType)
      if (gesture) this.push({ type: "gesture", gesture })
    }
    const sys = event.sysEvent
    if (sys) {
      const gesture = gestureFromSys(sys.eventType, sys.eventSource)
      if (gesture === "long_press" || gesture === "long_press_release") {
        console.log(`[recount] ${gesture} source ${sys.eventSource ?? "unknown"}`)
      }
      if (gesture) this.push({ type: "gesture", gesture })
    }
    const audio = event.audioEvent
    if (audio?.audioPcm?.length) this.pcm.push(audio.audioPcm)
  }

  private push(event: SessionEvent): void {
    this.queue = this.queue
      .then(() => this.apply(event))
      .catch((error: unknown) => {
        console.error("[recount]", error instanceof Error ? error.message : error)
      })
  }

  private async apply(event: SessionEvent): Promise<void> {
    const step = reduce(this.state, event, Date.now())
    this.state = step.state
    this.render()
    for (const effect of step.effects) {
      await this.runEffect(effect)
    }
  }

  private follow(event: SessionEvent): void {
    const step = reduce(this.state, event, Date.now())
    this.state = step.state
    this.render()
    for (const effect of step.effects) {
      void this.runEffect(effect)
    }
  }

  private async runEffect(effect: Effect): Promise<void> {
    switch (effect.type) {
      case "load":
        await this.load(effect.location)
        return
      case "commit":
        try {
          const saved = await postCount({
            id: effect.id,
            actual: effect.actual,
            damaged: effect.damaged,
            counter: this.counter,
          })
          this.follow({ type: "commit_ok", token: saved.token })
        } catch (error) {
          this.follow({
            type: "commit_failed",
            message: error instanceof Error ? error.message : "Not saved",
          })
        }
        return
      case "revert":
        try {
          const restored = await postUndo(effect.token)
          this.follow({ type: "revert_ok", item: restored.item })
        } catch (error) {
          this.follow({
            type: "revert_failed",
            message: error instanceof Error ? error.message : "Undo failed",
          })
        }
        return
      case "send_report":
        try {
          await postReport(effect.location, this.counter)
          this.follow({ type: "report_ok" })
        } catch (error) {
          this.follow({
            type: "report_failed",
            message: error instanceof Error ? error.message : "Report failed",
          })
        }
        return
      case "listen_start":
        this.pcm = []
        this.armListen()
        void setListening(true).catch(() => undefined)
        try {
          await Promise.race([
            this.bridge.audioControl(true, AudioInputSource.Glasses),
            sleep(500).then(() => false),
          ])
        } catch (error) {
          console.warn("[recount] mic", error instanceof Error ? error.message : error)
        }
        return
      case "listen_cancel":
        this.disarmListen()
        this.pcm = []
        void setListening(false).catch(() => undefined)
        await this.closeMic()
        return
      case "listen_stop":
        this.disarmListen()
        void setListening(false).catch(() => undefined)
        await this.closeMic()
        await this.finishVoice()
        return
      case "exit":
        await this.bridge.shutDownPageContainer(1)
        return
      default:
        return
    }
  }

  private async load(location: string): Promise<void> {
    const generation = ++this.loadGeneration
    try {
      const items = await getInventory(location)
      if (generation !== this.loadGeneration) return
      this.follow({ type: "loaded", items, location, counter: this.counter })
    } catch (error) {
      if (generation !== this.loadGeneration) return
      this.follow({
        type: "load_failed",
        message: error instanceof Error ? error.message : "Could not load",
      })
    }
  }

  private async finishVoice(): Promise<void> {
    try {
      const queued = await takeQueuedVoice()
      if (queued.transcript || queued.wavBase64) {
        const parsed = await postVoice({
          transcript: queued.transcript || undefined,
          wavBase64: queued.wavBase64 || undefined,
        })
        this.follow({ type: "voice", actual: parsed.actual, damaged: parsed.damaged })
        console.log(`[recount] voice ${parsed.source} ${parsed.actual} damaged ${parsed.damaged}`)
        return
      }
      const pcm = concat(this.pcm)
      this.pcm = []
      if (pcm.length < 1600) {
        this.follow({ type: "voice_failed" })
        return
      }
      const parsed = await postVoice({ wavBase64: bytesToBase64(pcm16leToWav(pcm)) })
      this.follow({ type: "voice", actual: parsed.actual, damaged: parsed.damaged })
      console.log(`[recount] voice ${parsed.source} ${parsed.actual}`)
    } catch (error) {
      console.warn("[recount] voice", error instanceof Error ? error.message : error)
      this.follow({ type: "voice_failed" })
    }
  }

  private async closeMic(): Promise<void> {
    try {
      await Promise.race([this.bridge.audioControl(false), sleep(500).then(() => false)])
    } catch {
      // Already closed, or the simulator has no microphone.
    }
  }

  private armListen(): void {
    this.disarmListen()
    this.listenTimer = setTimeout(() => this.push({ type: "listen_elapsed" }), LISTEN_WINDOW_MS)
  }

  private disarmListen(): void {
    if (this.listenTimer) clearTimeout(this.listenTimer)
    this.listenTimer = null
  }

  private render(): void {
    const copy = screenCopy(this.state)
    const label = screenLog(this.state)
    if (label !== this.logged) {
      console.log(`[recount] screen ${label}`)
      this.logged = label
    }
    this.hooks.onState(this.state, copy)
    if (copy.kicker !== this.painted.kicker) void this.upgrade(1, "kicker", copy.kicker, 2)
    if (copy.body !== this.painted.body) void this.upgrade(2, "body", copy.body, 4)
    if (copy.hint !== this.painted.hint) void this.upgrade(3, "hint", copy.hint, 2)
    this.painted = copy
  }

  private async upgrade(containerID: number, containerName: string, content: string, textColor: number) {
    const ok = await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID, containerName, content, textColor }),
    )
    if (!ok) console.warn(`[recount] text update failed ${containerName}`)
  }
}

function container(
  containerID: number,
  containerName: string,
  yPosition: number,
  height: number,
  content: string,
  textColor: number,
  isEventCapture: number,
  zOrderIndex: number,
): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 12,
    yPosition,
    width: 552,
    height,
    borderWidth: containerName === "body" ? 1 : 0,
    borderColor: 8,
    borderRadius: 0,
    paddingLength: 4,
    containerID,
    containerName,
    content,
    textColor,
    isEventCapture,
    zOrderIndex,
  })
}

function gestureFromSys(eventType: OsEventTypeList | undefined, eventSource: unknown): Gesture | null {
  switch (eventType) {
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return "double_tap"
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return "scroll_up"
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return "scroll_down"
    case OsEventTypeList.LONG_PRESS_EVENT:
      return "long_press"
    case OsEventTypeList.LONG_PRESS_RELEASE_EVENT:
      return "long_press_release"
    case OsEventTypeList.CLICK_EVENT:
      return "tap"
    case undefined:
      // The simulator omits event type 0. A source still means a tap.
      return eventSource === undefined ? null : "tap"
    default:
      return null
  }
}

function gestureFromText(eventType: OsEventTypeList | undefined): Gesture | null {
  switch (eventType) {
    case OsEventTypeList.CLICK_EVENT:
    case undefined:
      return "tap"
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return "double_tap"
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return "scroll_up"
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return "scroll_down"
    default:
      return null
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
