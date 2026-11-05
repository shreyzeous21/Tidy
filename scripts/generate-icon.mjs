/**
 * Generates Tidy's app icon (build/icon.png, 1024×1024) with a pure-Node
 * PNG encoder — no image dependencies.
 *
 * Design: an electric-blue → cyan → soft-purple gradient squircle holding a
 * clean white folder glyph with a sparkle sweeping its top-right corner —
 * "clean. organize. optimize." Subtle glow and a soft drop shadow add depth
 * without clutter. Rendered with signed-distance fields and 4× supersampling,
 * so it stays crisp at every dock / app-icon size.
 *
 * Run: npm run icons
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 1024
const SS = 4 // supersample factor
const BIG = SIZE * SS

// ---------- tiny PNG encoder ----------
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePNG(rgba, width, height) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  // scanlines with filter 0
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ---------- color + math helpers ----------
function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ]
}

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t
]

// Signed distance to a rounded rectangle (negative inside).
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r
}

// Signed distance to the squircle background (negative inside, full bleed).
const CORNER_R = 230
function sdSquircle(px, py) {
  return sdRoundRect(px, py, SIZE / 2, SIZE / 2, SIZE / 2, SIZE / 2, CORNER_R)
}

// Signed distance to the folder glyph: a rounded body with a raised tab.
// The tab runs past the body's top edge so the two merge into one silhouette
// (no notch along the folder's left wall).
const FOLDER = { left: 200, right: 824, tabTop: 320, tabRight: 452, bodyTop: 394, tabBottom: 470, bottom: 736 }
function sdFolder(px, py) {
  const body = sdRoundRect(
    px, py,
    (FOLDER.left + FOLDER.right) / 2, (FOLDER.bodyTop + FOLDER.bottom) / 2,
    (FOLDER.right - FOLDER.left) / 2, (FOLDER.bottom - FOLDER.bodyTop) / 2,
    54
  )
  const tab = sdRoundRect(
    px, py,
    (FOLDER.left + FOLDER.tabRight) / 2, (FOLDER.tabTop + FOLDER.tabBottom) / 2,
    (FOLDER.tabRight - FOLDER.left) / 2, (FOLDER.tabBottom - FOLDER.tabTop) / 2,
    38
  )
  return Math.min(body, tab)
}

// Four-point sparkle: |dx|^p + |dy|^p <= 1 is a concave star (p < 1).
// Each sits clear of the folder so the silhouette stays crisp at icon sizes.
const SPARKLES = [
  { cx: 790, cy: 244, r: 126, p: 0.62, glow: 0.5, gs: 0.62 },
  { cx: 892, cy: 502, r: 46, p: 0.58, glow: 0.38, gs: 0.62 }
]
const starField = (dx, dy, s) =>
  Math.pow(Math.abs(dx) / s.r, s.p) + Math.pow(Math.abs(dy) / s.r, s.p)

// ---------- palette ----------
const GRAD_A = hexToRgb('#4C86FF') // electric blue, top-left
const GRAD_B = hexToRgb('#3978FF') // primary electric blue
const GRAD_C = hexToRgb('#7B4DF6') // soft purple, bottom-right
const CYAN = hexToRgb('#42D9E8') // accent cyan
const CYAN_LIGHT = hexToRgb('#A9F0FF')
const FOLDER_TOP = hexToRgb('#FFFFFF')
const FOLDER_BOTTOM = hexToRgb('#EEF3FF')
const SHADOW = hexToRgb('#0A1B4E')
const DEPTH = hexToRgb('#2B1C7A')
const VIGNETTE = hexToRgb('#0B1A50')

// ---------- draw ----------
const big = new Uint8ClampedArray(BIG * BIG * 4) // premultiplied RGBA

for (let Y = 0; Y < BIG; Y++) {
  const y = Y / SS
  for (let X = 0; X < BIG; X++) {
    const x = X / SS
    const i = (Y * BIG + X) * 4

    if (sdSquircle(x, y) > 0) continue // transparent corner

    // Background: diagonal electric-blue → purple gradient.
    const t = Math.min(1, (x + y) / (SIZE * 2))
    let c = t < 0.5 ? mix(GRAD_A, GRAD_B, t * 2) : mix(GRAD_B, GRAD_C, (t - 0.5) * 2)

    // Fresh cyan bloom in the upper-left.
    const gdx = x - 300
    const gdy = y - 200
    c = mix(c, CYAN, 0.38 * Math.exp(-(gdx * gdx + gdy * gdy) / (2 * 380 * 380)))

    // Depth: gently cool, darker toward the bottom and the outer edge.
    const depth = Math.max(0, (y - 380) / (SIZE - 380))
    c = mix(c, DEPTH, 0.16 * depth * depth)
    const edge = Math.max(Math.abs(x - SIZE / 2), Math.abs(y - SIZE / 2)) / (SIZE / 2)
    c = mix(c, VIGNETTE, 0.06 * edge * edge * edge)

    // Folder drop shadow, faded out above the glyph so the top silhouette
    // stays crisp against the gradient.
    if (y > FOLDER.tabTop - 40 && x > FOLDER.left - 90 && x < FOLDER.right + 90 && y < FOLDER.bottom + 90) {
      const d = sdFolder(x, y - 24)
      const fade = Math.min(1, Math.max(0, (y - FOLDER.tabTop) / 150))
      c = mix(c, SHADOW, 0.30 * fade * Math.exp(-(d / 28) * (d / 28)))
    }

    // Folder glyph, with a soft top-to-bottom tint for dimension.
    if (x > FOLDER.left - 4 && x < FOLDER.right + 4 && y > FOLDER.tabTop - 4 && y < FOLDER.bottom + 4) {
      if (sdFolder(x, y) <= 0) {
        const ft = Math.min(1, Math.max(0, (y - FOLDER.tabTop) / (FOLDER.bottom - FOLDER.tabTop)))
        c = mix(FOLDER_TOP, FOLDER_BOTTOM, ft)
      }
    }

    // Sparkle glow (radial, falloff reaches zero inside the sampled box),
    // then the sparkle bodies themselves.
    for (const s of SPARKLES) {
      const sigma = s.r * s.gs
      const reach = s.r + sigma * 3.2
      const sdx = x - s.cx
      const sdy = y - s.cy
      if (Math.abs(sdx) > reach || Math.abs(sdy) > reach) continue
      c = mix(c, CYAN_LIGHT, s.glow * Math.exp(-(sdx * sdx + sdy * sdy) / (2 * sigma * sigma)))
      if (starField(sdx, sdy, s) <= 1) {
        const st = Math.min(1, Math.max(0, (y - (s.cy - s.r)) / (2 * s.r)))
        c = mix(FOLDER_TOP, CYAN_LIGHT, st)
      }
    }

    big[i] = c[0]
    big[i + 1] = c[1]
    big[i + 2] = c[2]
    big[i + 3] = 255
  }
}

// Box-downsample premultiplied RGBA for smooth antialiasing.
const out = Buffer.alloc(SIZE * SIZE * 4)
const N = SS * SS
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * BIG + (x * SS + sx)) * 4
        r += big[i]
        g += big[i + 1]
        b += big[i + 2]
        a += big[i + 3]
      }
    }
    const o = (y * SIZE + x) * 4
    r /= N
    g /= N
    b /= N
    a /= N
    if (a > 0) {
      const inv = 255 / a
      r *= inv
      g *= inv
      b *= inv
    }
    out[o] = Math.round(Math.min(255, r))
    out[o + 1] = Math.round(Math.min(255, g))
    out[o + 2] = Math.round(Math.min(255, b))
    out[o + 3] = Math.round(a)
  }
}

const root = path.dirname(fileURLToPath(import.meta.url))
const buildDir = path.join(root, '..', 'build')
mkdirSync(buildDir, { recursive: true })
writeFileSync(path.join(buildDir, 'icon.png'), encodePNG(out, SIZE, SIZE))

// Renderer-side copy for the sidebar brand.
const assetsDir = path.join(root, '..', 'src', 'renderer', 'src', 'assets')
mkdirSync(assetsDir, { recursive: true })
copyFileSync(path.join(buildDir, 'icon.png'), path.join(assetsDir, 'logo.png'))

console.log(`icon written: build/icon.png + src/renderer/src/assets/logo.png (${SIZE}×${SIZE})`)
