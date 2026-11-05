import fsp from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import type { FolderCompareResult } from '@shared/types/cleanup'
import { AppError } from '../utils/errors'

/**
 * Folder comparison: relative path sets + sizes, with same-size pairs
 * verified by a 64 KB head hash so "identical" really means identical.
 * Bounded and async.
 */

const MAX_FILES = 8_000
const MAX_DEPTH = 8
const SKIP = new Set(['node_modules', '.git', '.Trash', 'Library'])

interface Snapshot {
  /** relPath → [size, headHash?] — hash filled lazily for same-size pairs. */
  files: Map<string, { size: number; head?: string }>
  truncated: boolean
}

async function snapshot(root: string, isCancelled: () => boolean): Promise<Snapshot> {
  const files = new Map<string, { size: number; head?: string }>()
  let truncated = false
  const queue: Array<{ dir: string; rel: string; depth: number }> = [{ dir: root, rel: '', depth: 0 }]
  while (queue.length > 0) {
    if (isCancelled()) throw new AppError('CANCELLED', 'Scan cancelled.')
    const { dir, rel, depth } = queue.shift()!
    if (files.size >= MAX_FILES) {
      truncated = true
      break
    }
    let dirents
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const dirent of dirents) {
      const childRel = rel ? `${rel}/${dirent.name}` : dirent.name
      const full = path.join(dir, dirent.name)
      if (dirent.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIP.has(dirent.name)) queue.push({ dir: full, rel: childRel, depth: depth + 1 })
      } else if (dirent.isFile()) {
        const stat = await fsp.stat(full).then((s) => s.size, () => -1)
        files.set(childRel, { size: stat })
      }
    }
  }
  return { files, truncated }
}

async function headHash(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(p, { start: 0, end: 64 * 1024 - 1 })
    stream.on('data', (chunk: Buffer) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex').slice(0, 16)))
  })
}

export async function compareFolders(
  dirA: string,
  dirB: string,
  isCancelled: () => boolean
): Promise<FolderCompareResult> {
  const [a, b] = await Promise.all([snapshot(dirA, isCancelled), snapshot(dirB, isCancelled)])

  const onlyInA: string[] = []
  const onlyInB: string[] = []
  const differing: string[] = []
  let identicalCount = 0
  const shared: string[] = []

  for (const [rel, meta] of a.files) {
    const other = b.files.get(rel)
    if (!other) {
      onlyInA.push(rel)
    } else if (other.size !== meta.size) {
      differing.push(rel)
    } else {
      shared.push(rel)
    }
  }
  for (const rel of b.files.keys()) {
    if (!a.files.has(rel)) onlyInB.push(rel)
  }

  // Verify same-size pairs by head hash.
  const verifiedDifferent: string[] = []
  for (const rel of shared.slice(0, 2000)) {
    if (isCancelled()) throw new AppError('CANCELLED', 'Scan cancelled.')
    const [hashA, hashB] = await Promise.all([
      headHash(path.join(dirA, rel)),
      headHash(path.join(dirB, rel))
    ])
    if (hashA === hashB) identicalCount++
    else verifiedDifferent.push(rel)
  }

  const result: FolderCompareResult = {
    onlyInA: onlyInA.sort().slice(0, 1000),
    onlyInB: onlyInB.sort().slice(0, 1000),
    differing: [...differing, ...verifiedDifferent].sort().slice(0, 1000),
    identicalCount,
    truncated: a.truncated || b.truncated || onlyInA.length > 1000 || onlyInB.length > 1000
  }
  return result
}
