import fsp from 'node:fs/promises'
import { accessSync, createReadStream } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { Stats } from 'node:fs'
import type { FileEntry, MoveConflict, ConflictPolicy } from '@shared/types/files'
import { extensionOf, kindForFile } from '@shared/constants/categories'
import { AppError } from '../utils/errors'

/**
 * Core filesystem operations for Tidy's main process.
 *
 * This module is deliberately free of Electron imports so the risky logic
 * (collision handling, cross-volume moves, hashing) can be unit-tested
 * directly with Node's test runner.
 *
 * Safety rules implemented here:
 * - Never overwrite implicitly: callers must pass an explicit ConflictPolicy.
 * - Cross-volume file moves are copy → verify size → unlink source, and a
 *   failure after copying leaves the source in place.
 * - Symlinks are moved as links, never followed outside their parent.
 */

async function entryStat(p: string): Promise<{ stat: Stats; isSymlink: boolean }> {
  const stat = await fsp.lstat(p)
  return { stat, isSymlink: stat.isSymbolicLink() }
}

export async function listDirectory(dir: string): Promise<FileEntry[]> {
  let dirents
  try {
    dirents = await fsp.readdir(dir, { withFileTypes: true })
  } catch (error) {
    throw error // caller maps errno to AppErrorShape
  }

  const entries = await Promise.all(
    dirents.map(async (dirent): Promise<FileEntry> => {
      const fullPath = path.join(dir, dirent.name)
      let size = 0
      let modifiedAt = 0
      let isSymlink = false
      try {
        const { stat, isSymlink: link } = await entryStat(fullPath)
        isSymlink = link
        if (!link && stat.isFile()) size = Number(stat.size)
        modifiedAt = Math.floor(stat.mtimeMs)
      } catch {
        // Unreadable entry (permission): surface it with zeroed metadata instead of dropping it.
      }
      const isDirectory = dirent.isDirectory()
      return {
        name: dirent.name,
        path: fullPath,
        isDirectory,
        isSymlink,
        size,
        modifiedAt,
        kind: kindForFile(dirent.name, isDirectory),
        extension: isDirectory ? '' : extensionOf(dirent.name)
      }
    })
  )

  // Folders first, then case-insensitive by name. Stable and predictable.
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  })

  return entries
}

/** Unique-ify a target name using macOS-style "name (2).ext" suffixes. */
export function withNumericSuffix(targetPath: string): string {
  const dir = path.dirname(targetPath)
  const ext = path.extname(targetPath)
  const base = path.basename(targetPath, ext)
  for (let i = 2; i < 10_000; i++) {
    const candidate = path.join(dir, `${base} (${i})${ext}`)
    // exists() is deliberately checked without creating.
    if (!existsSyncSafe(candidate)) return candidate
  }
  throw new AppError('CONFLICT', 'Could not find an unused name for this item.')
}

function existsSyncSafe(p: string): boolean {
  try {
    accessSync(p)
    return true
  } catch {
    return false
  }
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.lstat(p)
    return true
  } catch {
    return false
  }
}

export interface RenameCheck {
  exists: boolean
  targetPath: string
  targetIsDirectory: boolean
}

/** Check whether renaming `dir/oldName` to `dir/newName` would collide. */
export async function checkRenameCollision(
  dir: string,
  oldName: string,
  newName: string
): Promise<RenameCheck> {
  const targetPath = path.join(dir, newName)
  if (newName === oldName) return { exists: false, targetPath, targetIsDirectory: false }
  const exists = await pathExists(targetPath)
  let targetIsDirectory = false
  if (exists) {
    try {
      targetIsDirectory = (await fsp.lstat(targetPath)).isDirectory()
    } catch {
      targetIsDirectory = false
    }
  }
  return { exists, targetPath, targetIsDirectory }
}

export async function renameEntry(
  dir: string,
  oldName: string,
  newName: string,
  overwrite: boolean
): Promise<string> {
  const sourcePath = path.join(dir, oldName)
  const targetPath = path.join(dir, newName)
  if (oldName !== newName && !overwrite) {
    const check = await checkRenameCollision(dir, oldName, newName)
    if (check.exists) {
      throw new AppError(
        check.targetIsDirectory ? 'CONFLICT' : 'ALREADY_EXISTS',
        check.targetIsDirectory
          ? 'A folder with that name already exists here.'
          : 'An item with that name already exists here.'
      )
    }
  }
  // rename() on macOS silently replaces an existing file target, which we
  // only ever allow when the caller passed overwrite=true explicitly.
  await fsp.rename(sourcePath, targetPath)
  return targetPath
}

/** Find destination collisions for a batch move without touching anything. */
export async function checkMoveConflicts(
  sources: string[],
  destinationDir: string
): Promise<MoveConflict[]> {
  const conflicts: MoveConflict[] = []
  for (const sourcePath of sources) {
    const sourceName = path.basename(sourcePath)
    const targetPath = path.join(destinationDir, sourceName)
    if (await pathExists(targetPath)) {
      let targetIsDirectory = false
      try {
        targetIsDirectory = (await fsp.lstat(targetPath)).isDirectory()
      } catch {
        targetIsDirectory = false
      }
      conflicts.push({ sourcePath, sourceName, targetPath, targetIsDirectory })
    }
  }
  return conflicts
}

export type MoveOutcome = 'moved' | 'replaced' | 'renamed' | 'skipped'

export interface MoveOneResult {
  outcome: MoveOutcome
  finalPath: string
}

/**
 * Move a single item into destinationDir honoring a conflict policy.
 * The caller must have validated paths; this function assumes trust.
 */
export async function moveEntry(
  sourcePath: string,
  destinationDir: string,
  policy: ConflictPolicy
): Promise<MoveOneResult> {
  const sourceName = path.basename(sourcePath)
  let targetPath = path.join(destinationDir, sourceName)
  const targetExists = await pathExists(targetPath)

  if (targetExists) {
    if (policy === 'skip') {
      return { outcome: 'skipped', finalPath: sourcePath }
    }
    if (policy === 'replace') {
      let targetIsDirectory = false
      try {
        targetIsDirectory = (await fsp.lstat(targetPath)).isDirectory()
      } catch {
        targetIsDirectory = false
      }
      if (targetIsDirectory) {
        throw new AppError(
          'CONFLICT',
          `“${sourceName}” collides with a folder. Replacing folders is not supported — choose “Keep both” or “Skip”.`
        )
      }
      await fsp.unlink(targetPath)
    } else {
      // keep-both
      targetPath = withNumericSuffix(targetPath)
    }
  }

  const sameVolume = await isSameVolume(sourcePath, destinationDir)
  if (sameVolume) {
    await fsp.rename(sourcePath, targetPath)
  } else {
    await moveAcrossVolumes(sourcePath, targetPath)
  }

  const renamed = targetPath !== path.join(destinationDir, sourceName)
  return {
    outcome: renamed ? 'renamed' : targetExists && policy === 'replace' ? 'replaced' : 'moved',
    finalPath: targetPath
  }
}

/** Cross-volume move: copy, verify, then remove the source. Source survives failures. */
export async function moveAcrossVolumes(sourcePath: string, targetPath: string): Promise<void> {
  const sourceStat = await fsp.lstat(sourcePath)
  if (sourceStat.isDirectory()) {
    throw new AppError(
      'UNSUPPORTED',
      '“' +
        path.basename(sourcePath) +
        '” is a folder on a different disk. Tidy can only move folders within one disk — drag it in Finder or copy it first.'
    )
  }
  await fsp.copyFile(sourcePath, targetPath)
  try {
    const copied = await fsp.stat(targetPath)
    if (copied.size !== sourceStat.size) {
      throw new AppError('UNKNOWN', 'Copy verification failed; the original was left untouched.')
    }
  } catch (error) {
    // Clean up the partial copy and rethrow; source is intact.
    await fsp.unlink(targetPath).catch(() => {})
    throw error
  }
  await fsp.unlink(sourcePath)
}

async function isSameVolume(a: string, b: string): Promise<boolean> {
  try {
    const [sa, sb] = await Promise.all([fsp.stat(a), fsp.stat(b)])
    return sa.dev === sb.dev
  } catch {
    // If either side is unreadable, let the subsequent rename/copy surface the real error.
    return true
  }
}

/** Stream a file through SHA-256 without loading it into memory. */
export async function hashFile(p: string, options?: { headBytes?: number }): Promise<string> {
  const headBytes = options?.headBytes
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = createReadStream(p, headBytes ? { start: 0, end: headBytes - 1 } : undefined)
    stream.on('data', (chunk: Buffer) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/** Concurrency-limited map used by scans. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/** Find the first unused name in `dir` among the given candidates. */
async function firstFreeName(dir: string, candidates: string[]): Promise<string> {
  for (const name of candidates) {
    if (!(await pathExists(path.join(dir, name)))) return name
  }
  throw new AppError('CONFLICT', 'Could not find an unused name in this folder.')
}

/** Create "untitled folder" (auto-numbered) inside `dir`. Returns the new path. */
export async function createFolderUnique(dir: string): Promise<string> {
  const candidates = ['untitled folder']
  for (let i = 2; i < 1000; i++) candidates.push(`untitled folder ${i}`)
  const name = await firstFreeName(dir, candidates)
  const target = path.join(dir, name)
  await fsp.mkdir(target)
  return target
}

/** Copy an item in place as "name copy.ext". Files and folders. */
export async function duplicateEntry(p: string): Promise<string> {
  const stat = await fsp.lstat(p)
  if (stat.isSymbolicLink()) {
    throw new AppError('UNSUPPORTED', 'Symlinks cannot be duplicated.')
  }
  const dir = path.dirname(p)
  const ext = path.extname(p)
  const base = path.basename(p, ext)
  const candidates = [`${base} copy${ext}`]
  for (let i = 2; i < 1000; i++) candidates.push(`${base} copy ${i}${ext}`)
  const name = await firstFreeName(dir, candidates)
  const target = path.join(dir, name)

  if (stat.isDirectory()) {
    // cp preserves the tree; errorOnExist guards races with force: false.
    await fsp.cp(p, target, { recursive: true, errorOnExist: true, force: false })
  } else {
    await fsp.copyFile(p, target)
  }
  return target
}

/** Build a FileEntry for a path (best-effort metadata; never throws). */
export async function toFileEntry(p: string): Promise<FileEntry> {
  const name = path.basename(p)
  let isDirectory = false
  let isSymlink = false
  let size = 0
  let modifiedAt = 0
  try {
    const { stat, isSymlink: link } = await entryStat(p)
    isSymlink = link
    isDirectory = stat.isDirectory()
    if (!link && stat.isFile()) size = stat.size
    modifiedAt = Math.floor(stat.mtimeMs)
  } catch {
    // metadata unavailable — entry still usable for selection/rename
  }
  return {
    name,
    path: p,
    isDirectory,
    isSymlink,
    size,
    modifiedAt,
    kind: kindForFile(name, isDirectory),
    extension: isDirectory ? '' : extensionOf(name)
  }
}

/**
 * Copy a single item into destinationDir (source is kept). Mirrors
 * moveEntry's conflict handling: never overwrites without an explicit
 * policy. Unlike moves, cross-volume folder copies are supported.
 */
export async function copyEntry(
  sourcePath: string,
  destinationDir: string,
  policy: ConflictPolicy
): Promise<MoveOneResult> {
  const sourceName = path.basename(sourcePath)
  let targetPath = path.join(destinationDir, sourceName)
  const targetExists = await pathExists(targetPath)

  if (targetExists) {
    if (policy === 'skip') {
      return { outcome: 'skipped', finalPath: sourcePath }
    }
    if (policy === 'replace') {
      let targetIsDirectory = false
      try {
        targetIsDirectory = (await fsp.lstat(targetPath)).isDirectory()
      } catch {
        targetIsDirectory = false
      }
      if (targetIsDirectory) {
        throw new AppError(
          'CONFLICT',
          `“${sourceName}” collides with a folder. Replacing folders is not supported — choose “Keep both” or “Skip”.`
        )
      }
      await fsp.unlink(targetPath)
    } else {
      targetPath = withNumericSuffix(targetPath)
    }
  }

  const sourceStat = await fsp.lstat(sourcePath)
  if (sourceStat.isDirectory()) {
    await fsp.cp(sourcePath, targetPath, { recursive: true, errorOnExist: true, force: false })
  } else if (sourceStat.isSymbolicLink()) {
    // Copy the link itself, not its target.
    await fsp.symlink(await fsp.readlink(sourcePath), targetPath)
  } else {
    await fsp.copyFile(sourcePath, targetPath)
  }

  const renamed = targetPath !== path.join(destinationDir, sourceName)
  return {
    outcome: renamed ? 'renamed' : targetExists && policy === 'replace' ? 'replaced' : 'moved',
    finalPath: targetPath
  }
}
