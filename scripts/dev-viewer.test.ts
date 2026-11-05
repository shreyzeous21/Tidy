/**
 * Tests for the developer artifact finder and the text reader.
 * Run with: npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { scanDevArtifacts, ARTIFACT_NAMES } from '../src/main/services/dev-artifacts'
import { computeFolderSize } from '../src/main/services/folder-size'
import { readTextContent } from '../src/main/services/filesystem'

const noop = (): void => {}
const measure = (dir: string): Promise<{ bytes: number; truncated: boolean }> => computeFolderSize(dir)

test('ARTIFACT_NAMES covers what developers delete first', () => {
  for (const name of ['node_modules', 'DerivedData', 'dist', 'build', 'target', '.gradle', '__pycache__']) {
    assert.ok(ARTIFACT_NAMES.has(name), `${name} should be an artifact`)
  }
})

test('scanDevArtifacts finds outermost artifacts only, with sizes', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tidy-dev-'))
  try {
    // project-a: node_modules containing a nested node_modules and files
    await fsp.mkdir(path.join(dir, 'project-a', 'node_modules', 'node_modules'), { recursive: true })
    await fsp.writeFile(path.join(dir, 'project-a', 'node_modules', 'pkg.js'), 'x'.repeat(2048))
    await fsp.writeFile(path.join(dir, 'project-a', 'src.ts'), 'const x = 1')
    // project-b: dist
    await fsp.mkdir(path.join(dir, 'project-b', 'dist'), { recursive: true })
    await fsp.writeFile(path.join(dir, 'project-b', 'dist', 'out.js'), 'y'.repeat(1024))
    // source that merely mentions nothing
    await fsp.writeFile(path.join(dir, 'readme.md'), 'hi')

    const found = await scanDevArtifacts(dir, () => false, noop, measure)
    const paths = found.map((a) => a.path).sort()
    assert.deepEqual(paths, [
      path.join(dir, 'project-a', 'node_modules'),
      path.join(dir, 'project-b', 'dist')
    ])
    const nodeModules = found.find((a) => a.name === 'node_modules')
    assert.ok(nodeModules)
    assert.ok(nodeModules.bytes >= 2048, 'node_modules size includes its contents')
    assert.equal(found.some((a) => a.path.includes('src.ts')), false)
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

test('readTextContent reads text, flags binary, and caps huge files', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tidy-read-'))
  try {
    const textPath = path.join(dir, 'note.txt')
    await fsp.writeFile(textPath, 'hello tidy\nline two\n')
    const text = await readTextContent(textPath)
    assert.equal(text.binary, false)
    assert.ok(text.content.startsWith('hello tidy'))
    assert.equal(text.truncated, false)

    const binPath = path.join(dir, 'blob.bin')
    await fsp.writeFile(binPath, Buffer.from([0x4f, 0x00, 0x4a]))
    const binary = await readTextContent(binPath)
    assert.equal(binary.binary, true)
    assert.equal(binary.content, '')

    const bigPath = path.join(dir, 'big.log')
    await fsp.writeFile(bigPath, 'z'.repeat(600 * 1024))
    const big = await readTextContent(bigPath)
    assert.equal(big.truncated, true)
    assert.ok(big.content.length <= 512 * 1024)

    await assert.rejects(() => readTextContent(dir), /Only files/)
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})
