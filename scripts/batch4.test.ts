/**
 * Tests for batch-4 additions: squarified treemap, git porcelain parsing,
 * perceptual hashing, and the folder finders. Run with: npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { squarify } from '../src/renderer/src/lib/treemap'
import { parsePorcelain } from '../src/main/services/git'
import { dHash64, hammingDistance, decodePng } from '../src/main/services/image-hash'
import zlib from 'node:zlib'
import { findBrokenLinks, findEmptyFiles, findTempFiles } from '../src/main/services/finders'

const noopCtx = () => ({ isCancelled: () => false, scanId: 't', onProgress: () => {} })

// ---------- treemap ----------

test('squarify covers the full canvas proportionally', () => {
  const items = [
    { name: 'a', path: '/a', bytes: 500 },
    { name: 'b', path: '/b', bytes: 300 },
    { name: 'c', path: '/c', bytes: 200 }
  ]
  const laid = squarify(items, 1000, 1000)
  assert.equal(laid.length, 3)
  const area = laid.reduce((sum, r) => sum + r.w * r.h, 0)
  assert.ok(Math.abs(area - 1_000_000) < 2, `expected full coverage, got ${area}`)
  const largest = laid.find((r) => r.name === 'a')
  const smallest = laid.find((r) => r.name === 'c')
  assert.ok(largest && smallest && largest.w * largest.h > smallest.w * smallest.h)
})

// ---------- git porcelain ----------

test('parsePorcelain counts modified vs untracked and extracts branch', () => {
  const parsed = parsePorcelain(
    ['## main...origin/main', ' M src/a.ts', '?? new.txt', '?? new2.txt', 'M  b.ts'].join('\n')
  )
  assert.equal(parsed.branch, 'main')
  assert.equal(parsed.modified, 2)
  assert.equal(parsed.untracked, 2)

  const clean = parsePorcelain('## main')
  assert.equal(clean.modified, 0)
  assert.equal(clean.untracked, 0)
})

// ---------- perceptual hashing ----------

/** Minimal 8-bit RGB PNG encoder with a two-stop gradient (vertical or horizontal). */
function gradientPng(
  width: number,
  height: number,
  from: [number, number, number],
  to: [number, number, number],
  vertical: boolean
): Buffer {
  const crcTable = (() => {
    const t = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c
    }
    return t
  })()
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0
    for (let x = 0; x < width; x++) {
      const t = vertical ? y / (height - 1) : x / (width - 1)
      const o = y * (1 + width * 3) + 1 + x * 3
      raw[o] = Math.round(from[0] + (to[0] - from[0]) * t)
      raw[o + 1] = Math.round(from[1] + (to[1] - from[1]) * t)
      raw[o + 2] = Math.round(from[2] + (to[2] - from[2]) * t)
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

test('dHash: identical gradients hash identically; different directions differ', () => {
  // dHash compares horizontally, so a horizontal gradient produces bits and
  // a vertical one (constant per row) hashes to all zeros — by design.
  const a = decodePng(gradientPng(24, 24, [220, 220, 220], [20, 20, 20], false))
  const b = decodePng(gradientPng(24, 24, [220, 220, 220], [20, 20, 20], false))
  const c = decodePng(gradientPng(24, 24, [20, 20, 20], [220, 220, 220], true))
  const hash = dHash64(a)
  assert.ok(hash !== '0'.repeat(32), 'a horizontal gradient must produce bits')
  assert.equal(hash, dHash64(b))
  assert.notEqual(hash, dHash64(c))
  assert.equal(hammingDistance(hash, hash), 0)
})

// ---------- finders ----------

test('findEmptyFiles/findTempFiles/findBrokenLinks fixtures', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tidy-finders-'))
  try {
    await fsp.writeFile(path.join(dir, 'empty.txt'), '')
    await fsp.writeFile(path.join(dir, 'full.txt'), 'data')
    await fsp.writeFile(path.join(dir, '~$report.docx'), 'lock')
    await fsp.writeFile(path.join(dir, 'thing.tmp'), 'temp')

    // broken symlink
    await fsp.symlink(path.join(dir, 'missing-target'), path.join(dir, 'broken.lnk'))

    const empty = await findEmptyFiles(dir, noopCtx())
    const temps = await findTempFiles(dir, noopCtx())
    const broken = await findBrokenLinks(dir, noopCtx())

    assert.deepEqual(empty.map((f) => f.name), ['empty.txt'])
    assert.ok(temps.some((f) => f.name === '~$report.docx'))
    assert.ok(temps.some((f) => f.name === 'thing.tmp'))
    assert.equal(broken.length, 1)
    assert.ok(broken[0].path.endsWith('broken.lnk'))
    assert.ok(broken[0].target.includes('missing-target'))
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})
