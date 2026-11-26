import type { ChatClient } from "../src/logic/parser"
import { base64ToBytes } from "../src/logic/wav"
import type { RecountConfig } from "./config"

export function openAiChat(config: RecountConfig): ChatClient | null {
  if (!config.llm) return null
  return {
    async complete(system: string, user: string) {
      const response = await fetch(`${config.llmBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.llmApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.llmModel,
          temperature: 0,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: AbortSignal.timeout(12000),
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`LLM ${response.status}: ${text.slice(0, 180)}`)
      const body = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> }
      const content = body.choices?.[0]?.message?.content
      if (!content) throw new Error("LLM returned an empty reply")
      return content
    },
  }
}

export async function transcribeWav(config: RecountConfig, wavBase64: string): Promise<string | null> {
  if (!config.stt) return null
  const bytes = base64ToBytes(wavBase64)
  const form = new FormData()
  form.set("model", config.llmSttModel)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  form.set("file", new Blob([copy], { type: "audio/wav" }), "count.wav")
  const response = await fetch(`${config.llmBaseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.llmApiKey}` },
    body: form,
    signal: AbortSignal.timeout(20000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Speech ${response.status}: ${text.slice(0, 180)}`)
  const body = JSON.parse(text) as { text?: string }
  const transcript = body.text?.trim() ?? ""
  return transcript || null
}
