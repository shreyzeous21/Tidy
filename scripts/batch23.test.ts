/**
 * Tests for batch-2/3 additions: cross-safe copy conflicts and the
 * organization-rule matcher. Run with: npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { copyEntry } from '../src/main/services/fs-core'
import { destinationFor, matchRule } from '../src/renderer/src/lib/rules'
import type { OrgRule } from '../shared/types/settings'
import type { FileEntry } from '../shared/types/files'

let dir: string
test.before(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tidy-copy-'))
  await fsp.mkdir(path.join(dir, 'in'), { recursive: true })
  await fsp.mkdir(path.join(dir, 'out'), { recursive: true })
  await fsp.writeFile(path.join(dir, 'in', 'doc.txt'), 'copy me')
})
test.after(async () => {
  await fsp.rm(dir, { recursive: true, force: true })
})

const entryOf = (name: string): FileEntry => ({
  name,
  path: `/x/${name}`,
  isDirectory: false,
  isSymlink: false,
  size: 1,
  modifiedAt: 0,
  kind: 'other',
  extension: ''
})

test('copyEntry skips collisions and keeps the source', async () => {
  const src = path.join(dir, 'in', 'doc.txt')
  await fsp.writeFile(path.join(dir, 'out', 'doc.txt'), 'existing')
  const result = await copyEntry(src, path.join(dir, 'out'), 'skip')
  assert.equal(result.outcome, 'skipped')
  assert.equal(await fsp.readFile(src, 'utf8'), 'copy me', 'source kept for copy operations')
})

test('copyEntry copies to a fresh name with keep-both', async () => {
  const src = path.join(dir, 'in', 'doc.txt')
  const result = await copyEntry(src, path.join(dir, 'out'), 'keep-both')
  assert.equal(result.outcome, 'renamed')
  assert.equal(path.basename(result.finalPath), 'doc (2).txt')
  assert.equal(await fsp.readFile(result.finalPath, 'utf8'), 'copy me')
  assert.equal(await fsp.readFile(src, 'utf8'), 'copy me', 'copy never removes the source')
})

// ---------- rules ----------

const RULES: OrgRule[] = [
  { id: 'r1', enabled: true, category: 'documents', nameContains: 'invoice', destination: '/dest/finance' },
  { id: 'r2', enabled: false, category: 'any', nameContains: '', destination: '/dest/disabled' }
]

test('rules: first matching enabled rule wins, disabled rules never match', () => {
  const invoice = entryOf('invoice-2026.pdf')
  assert.equal(matchRule(invoice, RULES)?.id, 'r1')
  assert.equal(destinationFor(invoice, RULES, {}).destination, '/dest/finance')
  assert.equal(destinationFor(invoice, RULES, {}).fromRule, true)

  // "any" rule is disabled → falls through to category default.
  const photo = entryOf('beach.jpg')
  assert.equal(matchRule(photo, RULES), null)
  assert.equal(destinationFor(photo, RULES, { images: '/dest/pics' }).destination, '/dest/pics')
  assert.equal(destinationFor(photo, RULES, { images: '/dest/pics' }).fromRule, false)
})

test('rules: name pattern must match, category is honored', () => {
  const pdf = entryOf('report.pdf')
  assert.equal(matchRule(pdf, RULES), null, 'no name match → no rule')
  assert.equal(destinationFor(pdf, RULES, { documents: '/dest/docs' }).destination, '/dest/docs')
})
