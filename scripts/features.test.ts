/**
 * Tests for Tidy's newer pure logic: bulk-rename planning, search operator
 * parsing, old-file and empty-folder scans. Run with: npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { planBulkRename } from '../src/renderer/src/lib/bulk-rename'
import type { BulkRenameOptions } from '../src/renderer/src/lib/bulk-rename'
import { parseQuery } from '../src/main/services/search'
import { CancelRegistry, scanEmptyFolders, scanOldFiles } from '../src/main/services/cleanup'
import type { FileEntry } from '../shared/types/files'

const noopProgress = (): void => {}

function entry(name: string, modifiedAt = 0): FileEntry {
  return {
    name,
    path: `/tmp/x/${name}`,
    isDirectory: false,
    isSymlink: false,
    size: 1,
    modifiedAt,
    kind: 'other',
    extension: ''
  }
}

// ---------- bulk rename planning ----------

const REPLACE: BulkRenameOptions = {
  mode: 'replace', find: 'IMG', replaceWith: 'photo', prefix: '', suffix: '',
  startNumber: 1, pad: 2, newExtension: ''
}

test('bulk rename: find & replace with live collision detection', () => {
  const rows = planBulkRename(
    [entry('IMG_0001.jpg'), entry('IMG_0002.jpg'), entry('notes.txt')],
    ['IMG_0001.jpg', 'IMG_0002.jpg', 'notes.txt'],
    REPLACE
  )
  assert.deepEqual(
    rows.map((r) => r.newName),
    ['photo_0001.jpg', 'photo_0002.jpg', 'notes.txt']
  )
  assert.deepEqual(
    rows.map((r) => r.status),
    ['ok', 'ok', 'unchanged']
  )
})

test('bulk rename: planned name that already exists in the folder collides', () => {
  const rows = planBulkRename([entry('a.txt')], ['a.txt', 'b.txt'], {
    ...REPLACE,
    find: 'a',
    replaceWith: 'b'
  })
  assert.equal(rows[0].newName, 'b.txt')
  assert.equal(rows[0].status, 'collision')
})

test('bulk rename: two planned names colliding with each other both flagged', () => {
  // Removing spaces makes both names converge on "ab.txt".
  const rows = planBulkRename([entry('a b.txt'), entry('a  b.txt')], [], {
    ...REPLACE,
    find: ' ',
    replaceWith: ''
  })
  assert.ok(rows.every((r) => r.status === 'collision'), 'duplicate targets must collide')
  assert.ok(rows.every((r) => r.newName === 'ab.txt'))
})

test('bulk rename: sequential numbering and extension change', () => {
  const numberRows = planBulkRename(
    [entry('holiday.png'), entry('holiday (1).png')],
    [],
    { ...REPLACE, mode: 'number', startNumber: 7, pad: 3 }
  )
  assert.equal(numberRows[0].newName, 'holiday 007.png')
  assert.equal(numberRows[1].newName, 'holiday (1) 008.png')

  const extRows = planBulkRename([entry('report.txt')], [], {
    ...REPLACE,
    mode: 'extension',
    newExtension: 'md'
  })
  assert.equal(extRows[0].newName, 'report.md')
})

// ---------- search operators ----------

test('search operators: type:, ext:, size: and name: are parsed', () => {
  const parsed = parseQuery('type:image size:>10mb invoice')
  assert.deepEqual(parsed.extensions, ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg'])
  assert.equal(parsed.minSizeBytes, 10 * 1024 * 1024)
  assert.equal(parsed.term, 'invoice')

  const multi = parseQuery('ext:zip,dmg backup')
  assert.deepEqual(multi.extensions, ['zip', 'dmg'])
  assert.equal(multi.term, 'backup')

  const capped = parseQuery('size:<1gb video')
  assert.equal(capped.maxSizeBytes, 1024 ** 3)

  const named = parseQuery('name:tax 2024')
  assert.equal(named.term, 'tax 2024')
})

test('search operators: natural language still works alongside', () => {
  const parsed = parseQuery('pdf larger than 20 mb')
  assert.ok(parsed.extensions.includes('pdf'))
  assert.equal(parsed.minSizeBytes, 20 * 1024 * 1024)
  assert.equal(parsed.term, '')
})

// ---------- old files + empty folders scans ----------

test('scanOldFiles returns only files older than the cutoff', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tidy-old-'))
  try {
    await fsp.writeFile(path.join(dir, 'ancient.txt'), 'old')
    await fsp.writeFile(path.join(dir, 'fresh.txt'), 'new')
    const distantPast = new Date('2001-01-01')
    // utimes expects Date objects (numeric args are seconds, not ms).
    await fsp.utimes(path.join(dir, 'ancient.txt'), distantPast, distantPast)

    const cancel = new CancelRegistry()
    const files = await scanOldFiles(dir, 365, 'old-scan', cancel, noopProgress)
    const names = files.map((f) => f.name)
    assert.ok(names.includes('ancient.txt'))
    assert.ok(!names.includes('fresh.txt'))
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

test('scanEmptyFolders reports outermost empty trees only', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tidy-empty-'))
  try {
    // empty-a (leaf), empty-b/nested (tree), full/ (has a file)
    await fsp.mkdir(path.join(dir, 'empty-a'))
    await fsp.mkdir(path.join(dir, 'empty-b', 'nested'), { recursive: true })
    await fsp.mkdir(path.join(dir, 'full'))
    await fsp.writeFile(path.join(dir, 'full', 'keep.txt'), 'x')

    const cancel = new CancelRegistry()
    const found = await scanEmptyFolders(dir, 'empty-scan', cancel, noopProgress)
    const names = found.map((p) => path.basename(p)).sort()
    assert.deepEqual(names, ['empty-a', 'empty-b'], 'outermost trees only; children not listed')
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

test('scanEmptyFolders ignores trees containing any file', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tidy-empty2-'))
  try {
    await fsp.mkdir(path.join(dir, 'deep', 'deeper'), { recursive: true })
    await fsp.writeFile(path.join(dir, 'deep', 'deeper', '.hidden'), crypto.randomBytes(8))
    const cancel = new CancelRegistry()
    const found = await scanEmptyFolders(dir, 'empty-scan-2', cancel, noopProgress)
    assert.equal(found.length, 0, 'a tree with a hidden file is not empty')
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})
