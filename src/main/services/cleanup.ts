import fsp from 'node:fs/promises'
import path from 'node:path'
import type { FileEntry } from '@shared/types/files'
import type { DuplicateGroup, ScanProgress } from '@shared/types/cleanup'
import { extensionOf, kindForFile } from '@shared/constants/categories'
import { hashFile, mapWithConcurrency } from './fs-core'
import { AppError } from '../utils/errors'

/**
 * Clean Up scans: large files and duplicate candidates.
 *
 * Duplicate detection follows a strict pipeline so nothing is ever labeled
 * a duplicate on name or size alone:
 *   1. group by exact size (candidate filter only)
 *   2. partial hash of the first 64 KB
 *   3. full streamed SHA-256
 * Files are only declared identical when full hashes match.
 *
 * All hashing is async I/O with bounded concurrency — the main process
 * event loop is never blocked. Scans are cancellable via a shared flag.
 */

const HASH_CONCURRENCY = 4
const PARTIAL_HASH_BYTES = 64 * 1024
const WALK_FILE_CAP = 60_000

/** Cancellation registry shared by IPC handlers. */
export class CancelRegistry {
  private cancelled = new Set<string>()

  cancel(scanId: string): void {
    this.cancelled.add(scanId)
  }

  isCancelled(scanId: string): boolean {
    return this.cancelled.has(scanId)
  }

  forget(scanId: string): void {
    this.cancelled.delete(scanId)
  }
}

interface CollectedFile {
  path: string
  size: number
  modifiedAt: number
}

const SKIP_DIR_NAMES = new Set([
  'node_modules', '.git', '.Trash', 'Library', '__pycache__', '.venv', 'DerivedData', '.npm'
])

/** Recursively collect files under roots, reporting progress and honoring cancellation. */
async function collectFiles(
  roots: string[],
  minSizeBytes: number,
  scanId: string,
  cancel: CancelRegistry,
  onProgress: (p: ScanProgress) => void
): Promise<CollectedFile[]> {
  const files: CollectedFile[] = []
  const queue: Array<{ dir: string; depth: number }> = roots.map((r) => ({ dir: r, depth: 0 }))
  let listed = 0

  while (queue.length > 0) {
    if (cancel.isCancelled(scanId)) throw new AppError('CANCELLED', 'Scan cancelled.')
    const { dir, depth } = queue.shift()!
    let dirents
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const dirent of dirents) {
      if (cancel.isCancelled(scanId)) throw new AppError('CANCELLED', 'Scan cancelled.')
      if (files.length >= WALK_FILE_CAP) return files
      const full = path.join(dir, dirent.name)
      if (dirent.isDirectory()) {
        if (depth < 10 && !SKIP_DIR_NAMES.has(dirent.name)) queue.push({ dir: full, depth: depth + 1 })
      } else if (dirent.isFile() || dirent.isSymbolicLink()) {
        listed++
        if (listed % 200 === 0) {
          onProgress({ scanId, phase: 'listing', processed: files.length, currentPath: full })
        }
        try {
          const stat = await fsp.lstat(full)
          if (stat.isFile() && stat.size >= minSizeBytes) {
            files.push({ path: full, size: stat.size, modifiedAt: Math.floor(stat.mtimeMs) })
          }
        } catch {
          // unreadable — skip
        }
      }
    }
  }
  return files
}

function toEntry(f: CollectedFile): FileEntry {
  return {
    name: path.basename(f.path),
    path: f.path,
    isDirectory: false,
    isSymlink: false,
    size: f.size,
    modifiedAt: f.modifiedAt,
    kind: kindForFile(path.basename(f.path), false),
    extension: extensionOf(path.basename(f.path))
  }
}

export async function scanLargeFiles(
  root: string,
  thresholdMB: number,
  scanId: string,
  cancel: CancelRegistry,
  onProgress: (p: ScanProgress) => void
): Promise<FileEntry[]> {
  const files = await collectFiles([root], thresholdMB * 1024 * 1024, scanId, cancel, onProgress)
  files.sort((a, b) => b.size - a.size)
  onProgress({ scanId, phase: 'done', processed: files.length, total: files.length })
  return files.map(toEntry)
}

/** Files untouched for `olderThanDays`, oldest first. */
export async function scanOldFiles(
  root: string,
  olderThanDays: number,
  scanId: string,
  cancel: CancelRegistry,
  onProgress: (p: ScanProgress) => void
): Promise<FileEntry[]> {
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
  const files = await collectFiles([root], 0, scanId, cancel, onProgress)
  const old = files.filter((f) => f.modifiedAt < cutoff)
  old.sort((a, b) => a.modifiedAt - b.modifiedAt)
  onProgress({ scanId, phase: 'done', processed: old.length, total: old.length })
  return old.slice(0, 5000).map(toEntry)
}

/**
 * Outermost "empty trees": directories whose entire subtree contains no
 * files (only folders, recursively). Children of a reported tree are not
 * reported separately. Returns paths, deepest-first within a parent.
 */
export async function scanEmptyFolders(
  root: string,
  scanId: string,
  cancel: CancelRegistry,
  onProgress: (p: ScanProgress) => void
): Promise<string[]> {
  const empty: string[] = []
  let visited = 0

  // Returns true when `dir` contains no files anywhere below it.
  const isEmptyTree = async (dir: string, depth: number): Promise<boolean> => {
    if (cancel.isCancelled(scanId)) throw new AppError('CANCELLED', 'Scan cancelled.')
    if (++visited % 100 === 0) onProgress({ scanId, phase: 'listing', processed: visited, currentPath: dir })
    if (depth > 10 || visited > 40_000) return false
    let dirents
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return false
    }
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) return false // a file/symlink anywhere → not empty
      if (!(await isEmptyTree(path.join(dir, dirent.name), depth + 1))) return false
    }
    // A folder with zero entries is trivially empty; one containing only
    // empty folders is empty too.
    return true
  }

  let topDirents
  try {
    topDirents = await fsp.readdir(root, { withFileTypes: true })
  } catch (error) {
    throw error
  }
  for (const dirent of topDirents) {
    if (!dirent.isDirectory() || SKIP_DIR_NAMES.has(dirent.name)) continue
    const full = path.join(root, dirent.name)
    if (await isEmptyTree(full, 0)) empty.push(full)
  }
  // Report parents before children; the UI trashes whole trees anyway.
  empty.sort((a, b) => a.localeCompare(b))
  onProgress({ scanId, phase: 'done', processed: empty.length, total: empty.length })
  return empty
}

export async function scanDuplicates(
  roots: string[],
  minSizeBytes: number,
  scanId: string,
  cancel: CancelRegistry,
  onProgress: (p: ScanProgress) => void
): Promise<DuplicateGroup[]> {
  // Phase 1: list + size filter.
  const files = await collectFiles(roots, minSizeBytes, scanId, cancel, onProgress)
  onProgress({ scanId, phase: 'listing', processed: files.length, total: files.length })

  // Phase 2: group by exact size.
  const bySize = new Map<number, CollectedFile[]>()
  for (const f of files) {
    const group = bySize.get(f.size)
    if (group) group.push(f)
    else bySize.set(f.size, [f])
  }
  const sizeCandidates = [...bySize.values()].filter((g) => g.length > 1).flat()
  if (sizeCandidates.length === 0) {
    onProgress({ scanId, phase: 'done', processed: 0, total: 0 })
    return []
  }

  // Phase 3: partial hash (first 64 KB) to prune cheaply.
  onProgress({ scanId, phase: 'hashing-partial', processed: 0, total: sizeCandidates.length })
  let done = 0
  const partialGroups = new Map<string, CollectedFile[]>()
  await mapWithConcurrency(sizeCandidates, HASH_CONCURRENCY, async (f) => {
    if (cancel.isCancelled(scanId)) return
    try {
      const hash = await hashFile(f.path, { headBytes: PARTIAL_HASH_BYTES })
      const key = `${f.size}:${hash}`
      const group = partialGroups.get(key)
      if (group) group.push(f)
      else partialGroups.set(key, [f])
    } catch {
      // unreadable — exclude from duplicate candidates
    } finally {
      done++
      if (done % 25 === 0) {
        onProgress({ scanId, phase: 'hashing-partial', processed: done, total: sizeCandidates.length, currentPath: f.path })
      }
    }
  })
  if (cancel.isCancelled(scanId)) throw new AppError('CANCELLED', 'Scan cancelled.')

  const fullCandidates = [...partialGroups.values()].filter((g) => g.length > 1).flat()
  if (fullCandidates.length === 0) {
    onProgress({ scanId, phase: 'done', processed: 0, total: 0 })
    return []
  }

  // Phase 4: full streamed SHA-256 — identical content only.
  onProgress({ scanId, phase: 'hashing-full', processed: 0, total: fullCandidates.length })
  done = 0
  const fullGroups = new Map<string, CollectedFile[]>()
  await mapWithConcurrency(fullCandidates, HASH_CONCURRENCY, async (f) => {
    if (cancel.isCancelled(scanId)) return
    try {
      const hash = await hashFile(f.path)
      const group = fullGroups.get(hash)
      if (group) group.push(f)
      else fullGroups.set(hash, [f])
    } catch {
      // unreadable — exclude
    } finally {
      done++
      if (done % 10 === 0) {
        onProgress({ scanId, phase: 'hashing-full', processed: done, total: fullCandidates.length, currentPath: f.path })
      }
    }
  })
  if (cancel.isCancelled(scanId)) throw new AppError('CANCELLED', 'Scan cancelled.')

  const groups: DuplicateGroup[] = []
  for (const [hash, group] of fullGroups) {
    if (group.length > 1) {
      // Oldest file first so "keep the original" is the natural default.
      group.sort((a, b) => a.modifiedAt - b.modifiedAt)
      groups.push({ hash, size: group[0].size, files: group.map(toEntry) })
    }
  }
  groups.sort((a, b) => b.size * b.files.length - a.size * a.files.length)

  onProgress({ scanId, phase: 'done', processed: groups.length, total: groups.length })
  return groups
}
