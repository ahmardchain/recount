import { inflateSync, deflateSync } from "node:zlib"

/**
 * The simulator framebuffer is green in RGB and puts glyph brightness in alpha.
 * A normal image viewer then shows a flat green field. This writes a black
 * canvas with the same green text so the saved shots can be read.
 */
export function compositeGlassesPng(input: Buffer): Buffer {
  const { width, height, rows } = decodeRgba(input)
  const raw = Buffer.alloc(height * (1 + width * 4))
  let offset = 0
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0
    offset += 1
    const row = rows[y]
    if (!row) continue
    for (let x = 0; x < width; x += 1) {
      const alpha = row[x * 4 + 3] ?? 0
      raw[offset] = 0
      raw[offset + 1] = alpha
      raw[offset + 2] = 0
      raw[offset + 3] = 255
      offset += 4
    }
  }
  return encodeRgba(width, height, deflateSync(raw))
}

function decodeRgba(png: Buffer): { width: number; height: number; rows: Uint8Array[] } {
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("Screenshot is not a PNG")
  }
  let offset = 8
  let width = 0
  let height = 0
  const idat: Buffer[] = []
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.subarray(offset + 4, offset + 8).toString("ascii")
    const data = png.subarray(offset + 8, offset + 8 + length)
    if (type === "IHDR") {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[9] !== 6) throw new Error("Expected an RGBA screenshot")
    } else if (type === "IDAT") {
      idat.push(data)
    } else if (type === "IEND") {
      break
    }
    offset += 12 + length
  }
  const inflated = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const rows: Uint8Array[] = []
  let cursor = 0
  let previous = new Uint8Array(stride)
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[cursor]
    cursor += 1
    const row = inflated.subarray(cursor, cursor + stride)
    cursor += stride
    const out = new Uint8Array(stride)
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? out[x - 4] ?? 0 : 0
      const up = previous[x] ?? 0
      const upLeft = x >= 4 ? previous[x - 4] ?? 0 : 0
      const value = row[x] ?? 0
      if (filter === 0) out[x] = value
      else if (filter === 1) out[x] = (value + left) & 255
      else if (filter === 2) out[x] = (value + up) & 255
      else if (filter === 3) out[x] = (value + Math.floor((left + up) / 2)) & 255
      else if (filter === 4) out[x] = (value + paeth(left, up, upLeft)) & 255
      else throw new Error(`Unknown PNG filter ${filter}`)
    }
    previous = out
    rows.push(out)
  }
  return { width, height, rows }
}

function encodeRgba(width: number, height: number, compressed: Buffer): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0))])
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])) >>> 0)
  return Buffer.concat([length, name, data, crc])
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const diagonal = Math.abs(estimate - upLeft)
  if (leftDistance <= upDistance && leftDistance <= diagonal) return left
  if (upDistance <= diagonal) return up
  return upLeft
}

const CRC_TABLE = new Uint32Array(256)
for (let index = 0; index < 256; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  CRC_TABLE[index] = value
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    const entry = CRC_TABLE[(crc ^ byte) & 255] ?? 0
    crc = entry ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}
