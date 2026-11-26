import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { base64ToBytes, bytesToBase64, pcm16leToWav } from "../src/logic/wav"

describe("wav", () => {
  it("wraps glasses PCM in a wav the speech endpoint can accept", () => {
    const pcm = new Uint8Array([0, 1, 2, 3])
    const wav = pcm16leToWav(pcm, 16000)
    assert.equal(Buffer.from(wav.subarray(0, 4)).toString("ascii"), "RIFF")
    assert.equal(Buffer.from(wav.subarray(8, 12)).toString("ascii"), "WAVE")
    assert.equal(wav.length, 48)
    const round = base64ToBytes(bytesToBase64(wav))
    assert.deepEqual(round, wav)
  })
})