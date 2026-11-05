/**
 * Fixture tests for Tidy's Electron-free filesystem core and duplicate
 * scanner. Run with: npm test
 *
 * Everything happens in a fresh temp directory; the tests never touch
 * anything outside os.tmpdir().
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {
  listDirectory,
  renameEntry,
  checkMoveConflicts,
  moveEntry,
  moveAcrossVolumes,
  hashFile,
  withNumericSuffix,
  pathExists
} from '../src/main/services/fs-core'
import { AppError } from '../src/main/utils/errors'
import { CancelRegistry, scanDuplicates, scanLargeFiles } from '../src/main/services/cleanup'

let fixtureDir: string

beforeEach(async () => {
  fixtureDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tidy-test-'))
})

afterEach(async () => {
  await fsp.rm(fixtureDir, { recursive: true, force: true })
})

async function write(name: string, content: string | Buffer): Promise<string> {
  const p = path.join(fixtureDir, name)
  await fsp.mkdir(path.dirname(p), { recursive: true })
  await fsp.writeFile(p, content)
  return p
}

const noopProgress = (): void => {}
const freshCancel = (): CancelRegistry => new CancelRegistry()

// ---------- listDirectory ----------

test('listDirectory lists folders first with metadata', async () => {
  await write('b.txt', 'hello')
  await write('a.txt', 'hi')
  await fsp.mkdir(path.join(fixtureDir, 'zdir'))
  await fsp.mkdir(path.join(fixtureDir, 'adir'))

  const entries = await listDirectory(fixtureDir)
  const names = entries.map((e) => e.name)
  assert.deepEqual(names, ['adir', 'zdir', 'a.txt', 'b.txt'])
  assert.equal(entries[0].isDirectory, true)
  const b = entries.find((e) => e.name === 'b.txt')
  assert.ok(b)
  assert.equal(b.size, 5) // 'hello' is 5 bytes
  assert.equal(b.kind, 'document')
  assert.equal(b.extension, 'txt')
  assert.ok(b.modifiedAt > 0)
})

// ---------- renameEntry ----------

test('renameEntry renames and detects collisions', async () => {
  const a = await write('report.txt', 'v1')
  await write('other.txt', 'x')

  const finalPath = await renameEntry(fixtureDir, 'report.txt', 'renamed.txt', false)
  assert.equal(finalPath, path.join(fixtureDir, 'renamed.txt'))
  assert.equal(await pathExists(a), false)

  // Collision: renamed.txt already exists.
  await assert.rejects(
    () => renameEntry(fixtureDir, 'other.txt', 'renamed.txt', false),
    (error: unknown) => error instanceof AppError && error.code === 'ALREADY_EXISTS'
  )
  // Original survives a failed rename.
  assert.equal(await pathExists(path.join(fixtureDir, 'other.txt')), true)

  // Explicit overwrite is allowed and replaces content.
  const overwritten = await renameEntry(fixtureDir, 'other.txt', 'renamed.txt', true)
  assert.equal(overwritten, path.join(fixtureDir, 'renamed.txt'))
  const content = await fsp.readFile(path.join(fixtureDir, 'renamed.txt'), 'utf8')
  assert.equal(content, 'x')
})

// ---------- move policies ----------

test('moveEntry skip policy leaves both files untouched', async () => {
  const src = await write('in/skip-me.txt', 'src')
  await write('out/skip-me.txt', 'dest')

  const conflicts = await checkMoveConflicts([src], path.join(fixtureDir, 'out'))
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].targetIsDirectory, false)

  const result = await moveEntry(src, path.join(fixtureDir, 'out'), 'skip')
  assert.equal(result.outcome, 'skipped')
  assert.equal(await pathExists(src), true, 'source must survive a skipped move')
})

test('moveEntry keep-both auto-renames with numeric suffix', async () => {
  const src = await write('in/both.txt', 'newer')
  await write('out/both.txt', 'older')

  const result = await moveEntry(src, path.join(fixtureDir, 'out'), 'keep-both')
  assert.equal(result.outcome, 'renamed')
  assert.equal(path.basename(result.finalPath), 'both (2).txt')
  const keptOld = await fsp.readFile(path.join(fixtureDir, 'out', 'both.txt'), 'utf8')
  assert.equal(keptOld, 'older', 'existing file must not be touched by keep-both')
  assert.equal(await pathExists(src), false)
})

test('moveEntry replace policy overwrites only on explicit request', async () => {
  const src = await write('in/rep.txt', 'fresh data')
  await write('out/rep.txt', 'stale data')

  const result = await moveEntry(src, path.join(fixtureDir, 'out'), 'replace')
  assert.equal(result.outcome, 'replaced')
  const content = await fsp.readFile(path.join(fixtureDir, 'out', 'rep.txt'), 'utf8')
  assert.equal(content, 'fresh data')
  assert.equal(await pathExists(src), false)
})

test('moveEntry replace refuses to replace a folder', async () => {
  const src = await write('in/doc.txt', 'data')
  await fsp.mkdir(path.join(fixtureDir, 'out', 'doc.txt'), { recursive: true })

  await assert.rejects(
    () => moveEntry(src, path.join(fixtureDir, 'out'), 'replace'),
    (error: unknown) => error instanceof AppError && error.code === 'CONFLICT'
  )
  assert.equal(await pathExists(src), true)
})

test('cross-volume move copies, verifies, then removes the source', async () => {
  const src = await write('in/cross.txt', 'cross volume payload')
  const outDir = path.join(fixtureDir, 'other-volume')
  await fsp.mkdir(outDir)

  await moveAcrossVolumes(src, path.join(outDir, 'cross.txt'))
  const content = await fsp.readFile(path.join(outDir, 'cross.txt'), 'utf8')
  assert.equal(content, 'cross volume payload')
  assert.equal(await pathExists(src), false, 'source is removed only after verification')
})

// ---------- hashing ----------

test('hashFile distinguishes identical and different content', async () => {
  const payload = crypto.randomBytes(256 * 1024)
  const f1 = await write('h1.bin', payload)
  const f2 = await write('h2.bin', payload)
  const f3 = await write('h3.bin', crypto.randomBytes(256 * 1024))

  const h1 = await hashFile(f1)
  const h2 = await hashFile(f2)
  const h3 = await hashFile(f3)
  assert.equal(h1, h2, 'identical content must produce identical hashes')
  assert.notEqual(h1, h3)

  // Head-only hash matches when heads match even if tails differ.
  const h1head = await hashFile(f1, { headBytes: 64 * 1024 })
  assert.notEqual(h1head, h1, 'head hash differs from full hash')
  assert.equal(h1head, await hashFile(f2, { headBytes: 64 * 1024 }))
})

// ---------- suffix helper ----------

test('withNumericSuffix finds the first free name', async () => {
  await write('clip.txt', 'one')
  const target = path.join(fixtureDir, 'clip.txt')
  assert.equal(path.basename(withNumericSuffix(target)), 'clip (2).txt')

  await write('clip (2).txt', 'two')
  assert.equal(path.basename(withNumericSuffix(target)), 'clip (3).txt')
})

// ---------- duplicate scanner ----------

test('scanDuplicates groups only byte-identical files', async () => {
  const payload = crypto.randomBytes(8 * 1024)
  await write('dup/a1.bin', payload)
  await write('dup/nested/a2.bin', payload) // same content, different name+folder
  await write('dup/b1.bin', crypto.randomBytes(8 * 1024)) // same size, different content
  await write('dup/tiny.bin', 'too small')

  const cancel = freshCancel()
  const groups = await scanDuplicates(
    [path.join(fixtureDir, 'dup')],
    4 * 1024,
    'scan-test-1',
    cancel,
    noopProgress
  )

  assert.equal(groups.length, 1, 'exactly one duplicate group expected')
  const group = groups[0]
  assert.equal(group.files.length, 2)
  const names = group.files.map((f) => f.name).sort()
  assert.deepEqual(names, ['a1.bin', 'a2.bin'])
  assert.ok(group.hash.length > 0, 'full content hash present')
  assert.equal(group.size, payload.length)
})

test('scanLargeFiles returns files sorted by size desc', async () => {
  await write('big/one.bin', Buffer.alloc(600 * 1024, 1))
  await write('big/two.bin', Buffer.alloc(1200 * 1024, 2))
  await write('big/small.bin', Buffer.alloc(10 * 1024, 3))

  const cancel = freshCancel()
  const files = await scanLargeFiles(
    path.join(fixtureDir, 'big'),
    0.5, // MB threshold
    'scan-test-2',
    cancel,
    noopProgress
  )
  const names = files.map((f) => f.name)
  assert.deepEqual(names, ['two.bin', 'one.bin'])
})

test('cancellation stops a duplicate scan with CANCELLED error', async () => {
  await write('c/x.bin', crypto.randomBytes(16 * 1024))
  await write('c/y.bin', crypto.randomBytes(16 * 1024))

  const cancel = freshCancel()
  cancel.cancel('scan-test-3')
  await assert.rejects(
    () => scanDuplicates([path.join(fixtureDir, 'c')], 1024, 'scan-test-3', cancel, noopProgress),
    (error: unknown) => error instanceof AppError && error.code === 'CANCELLED'
  )
})
