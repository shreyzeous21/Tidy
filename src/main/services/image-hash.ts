import { inflateSync } from 'node:zlib'

/**
 * Minimal 8-bit PNG decoder (color types 0/2/6, no interlace) — just enough
 * to turn sips-resized thumbnails into pixel arrays for perceptual hashing.
 * Pure and unit-testable; no image dependencies.
 */

export interface RawImage {
  width: number
  height: number
  /** RGBA rows, width*height*4. */
  data: Buffer
}

export function decodePng(buffer: Buffer): RawImage {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat: Buffer[] = []
  while (pos + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(pos)
    const type = buffer.toString('ascii', pos + 4, pos + 8)
    const data = buffer.subarray(pos + 8, pos + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      if (data[12] !== 0) throw new Error('interlaced PNG not supported')
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + length
  }
  if (bitDepth !== 8) throw new Error('only 8-bit PNG supported')
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 6 ? 4 : 0
  if (channels === 0) throw new Error('unsupported color type')

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(width * height * 4)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const current = Buffer.alloc(stride)
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? current[x - channels] : 0
      const up = prev[x]
      const upLeft = x >= channels ? prev[x - channels] : 0
      let value = row[x]
      switch (filter) {
        case 1:
          value = (value + left) & 0xff
          break
        case 2:
          value = (value + up) & 0xff
          break
        case 3:
          value = (value + ((left + up) >> 1)) & 0xff
          break
        case 4: {
          const p = left + up - upLeft
          const pa = Math.abs(p - left)
          const pb = Math.abs(p - up)
          const pc = Math.abs(p - upLeft)
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
          value = (value + predictor) & 0xff
          break
        }
      }
      current[x] = value
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      if (channels === 1) {
        pixels[o] = pixels[o + 1] = pixels[o + 2] = current[x]
        pixels[o + 3] = 255
      } else if (channels === 3) {
        pixels[o] = current[x * 3]
        pixels[o + 1] = current[x * 3 + 1]
        pixels[o + 2] = current[x * 3 + 2]
        pixels[o + 3] = 255
      } else {
        pixels[o] = current[x * 4]
        pixels[o + 1] = current[x * 4 + 1]
        pixels[o + 2] = current[x * 4 + 2]
        pixels[o + 3] = current[x * 4 + 3]
      }
    }
    prev = current
  }
  return { width, height, data: pixels }
}

/** 64-bit difference hash from a raw RGBA image (pure). */
export function dHash64(image: RawImage): string {
  const W = 9
  const H = 8
  // Downsample to 9x8 grayscale with box averaging.
  const gray: number[] = new Array(W * H).fill(0)
  for (let gy = 0; gy < H; gy++) {
    for (let gx = 0; gx < W; gx++) {
      const x0 = Math.floor((gx * image.width) / W)
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * image.width) / W))
      const y0 = Math.floor((gy * image.height) / H)
      const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * image.height) / H))
      let sum = 0
      let count = 0
      for (let y = y0; y < y1 && y < image.height; y++) {
        for (let x = x0; x < x1 && x < image.width; x++) {
          const o = (y * image.width + x) * 4
          sum += 0.299 * image.data[o] + 0.587 * image.data[o + 1] + 0.114 * image.data[o + 2]
          count++
        }
      }
      gray[gy * W + gx] = count > 0 ? sum / count : 0
    }
  }
  let hex = ''
  for (let byte = 0; byte < 16; byte++) {
    let value = 0
    for (let bit = 0; bit < 4; bit++) {
      const index = byte * 4 + bit
      const col = index % (W - 1)
      const row = Math.floor(index / (W - 1))
      if (gray[row * W + col] > gray[row * W + col + 1]) value |= 1 << (3 - bit)
    }
    hex += value.toString(16).padStart(2, '0')
  }
  return hex
}

export function hammingDistance(a: string, b: string): number {
  let distance = 0
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const va = parseInt(a[i] ?? '0', 16)
    const vb = parseInt(b[i] ?? '0', 16)
    let diff = va ^ vb
    while (diff) {
      distance += diff & 1
      diff >>= 1
    }
  }
  return distance
}
