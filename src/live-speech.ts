/** Browser Web Speech API. Used on the shop page so a count can be spoken live in the simulator. This is the computer microphone, not the G2 headset. */

export interface LiveListenHandle {
  stop: () => void
}

interface RecognitionResult {
  isFinal: boolean
  0?: { transcript?: string }
  length: number
}

interface RecognitionEvent {
  resultIndex: number
  results: ArrayLike<RecognitionResult>
}

interface RecognitionErrorEvent {
  error?: string
}

interface BrowserRecognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: RecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type RecognitionCtor = new () => BrowserRecognition

interface SpeechWindow extends Window {
  SpeechRecognition?: RecognitionCtor
  webkitSpeechRecognition?: RecognitionCtor
}

export function getSpeechRecognition(): RecognitionCtor | null {
  if (typeof window === "undefined") return null
  const view = window as SpeechWindow
  return view.SpeechRecognition ?? view.webkitSpeechRecognition ?? null
}

export function liveSpeechSupported(): boolean {
  return getSpeechRecognition() !== null
}

export function startLiveListen(handlers: {
  onTranscript: (text: string, isFinal: boolean) => void
  onError: (message: string) => void
  onEnd?: () => void
}): LiveListenHandle | null {
  const Recognition = getSpeechRecognition()
  if (!Recognition) return null
  const recognition = new Recognition()
  recognition.lang = "en-US"
  recognition.interimResults = true
  recognition.continuous = true
  recognition.onresult = (event: RecognitionEvent) => {
    let interim = ""
    let finalText = ""
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index]
      const said = result?.[0]?.transcript?.trim() ?? ""
      if (!said) continue
      if (result.isFinal) finalText = finalText ? `${finalText} ${said}` : said
      else interim = interim ? `${interim} ${said}` : said
    }
    if (finalText) handlers.onTranscript(finalText, true)
    else if (interim) handlers.onTranscript(interim, false)
  }
  recognition.onerror = (event: RecognitionErrorEvent) => {
    if (event.error === "aborted" || event.error === "no-speech") return
    handlers.onError(event.error || "Speech recognition failed")
  }
  recognition.onend = () => {
    handlers.onEnd?.()
  }
  recognition.start()
  return {
    stop() {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      recognition.stop()
    },
  }
}
