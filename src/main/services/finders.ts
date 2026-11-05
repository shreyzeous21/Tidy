import fsp from 'node:fs/promises'
import path from 'node:path'
import type { FileEntry } from '@shared/types/files'
import type {
  BrokenLink,
  DuplicateFolderGroup,
  CacheItem
} from '@shared/types/cleanup'
import { AppError } from '../utils/errors'

/**
 * Small focused finders shared by the Clean Up tools. All walks are
 * bounded and async — the main process never blocks.
 */

const WALK_CAP = 30_000
const MAX_DEPTH = 8
const SKIP = new Set(['node_modules', '.git', '.Trash', 'Library', '__pycache__', '.venv', 'DerivedData', '.npm'])

export interface WalkContext {
  isCancelled: () => boolean
  scanId: string
  onProgress: (processed: number, currentPath: string) => void
}

function toEntry(p: string, stat: import('node:fs').Stats): FileEntry {
  return {
    name: path.basename(p),
    path: p,
    isDirectory: false,
    isSymlink: stat.isSymbolicLink(),
    size: stat.size,
    modifiedAt: Math.floor(stat.mtimeMs),
    kind: 'other',
    extension: ''
  }
}

/** Files with zero bytes. */
export async function findEmptyFiles(root: string, ctx: WalkContext): Promise<FileEntry[]> {
  const out: FileEntry[] = []
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  let visited = 0
  while (queue.length > 0) {
    if (ctx.isCancelled()) throw new AppError('CANCELLED', 'Scan cancelled.')
    const { dir, depth } = queue.shift()!
    if (++visited > WALK_CAP) break
    if (visited % 100 === 0) ctx.onProgress(out.length, dir)
    let dirents
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const dirent of dirents) {
      const full = path.join(dir, dirent.name)
      if (dirent.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIP.has(dirent.name)) queue.push({ dir: full, depth: depth + 1 })
      } else if (dirent.isFile() && (await fsp.stat(full).then((s) => s.size === 0, () => false))) {
        out.push(toEntry(full, await fsp.lstat(full)))
        if (out.length >= 2000) return out
      }
    }
  }
  return out
}

/** Symlinks whose target no longer exists. */
export async function findBrokenLinks(root: string, ctx: WalkContext): Promise<BrokenLink[]> {
  const out: Array<{ path: string; target: string }> = []
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  let visited = 0
  while (queue.length > 0) {
    if (ctx.isCancelled()) throw new AppError('CANCELLED', 'Scan cancelled.')
    const { dir, depth } = queue.shift()!
    if (++visited > WALK_CAP) break
    if (visited % 100 === 0) ctx.onProgress(out.length, dir)
    let dirents
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const dirent of dirents) {
      const full = path.join(dir, dirent.name)
      if (dirent.isSymbolicLink()) {
        const target = await fsp.readlink(full).catch(() => '')
        const resolved = path.resolve(path.dirname(full), target)
        const broken = await fsp.stat(resolved).then(() => false, () => true)
        if (broken) {
          out.push({ path: full, target })
          if (out.length >= 1000) return out
        }
      } else if (dirent.isDirectory() && depth < MAX_DEPTH && !SKIP.has(dirent.name)) {
        queue.push({ dir: full, depth: depth + 1 })
      }
    }
  }
  return out
}

const TEMP_PATTERNS = [/~\$/, /\.tmp$/i, /\.temp$/i, /\.part$/i, /\.crdownload$/i, /\.download$/i, /^\.ds_store$/i, /^thumbs\.db$/i, /^desktop\.ini$/i, /\.bak$/i]

/** Leftover temp/backup files by name pattern. */
export async function findTempFiles(root: string, ctx: WalkContext): Promise<FileEntry[]> {
  const out: FileEntry[] = []
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  let visited = 0
  while (queue.length > 0) {
    if (ctx.isCancelled()) throw new AppError('CANCELLED', 'Scan cancelled.')
    const { dir, depth } = queue.shift()!
    if (++visited > WALK_CAP) break
    if (visited % 100 === 0) ctx.onProgress(out.length, dir)
    let dirents
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const dirent of dirents) {
      const full = path.join(dir, dirent.name)
      if (dirent.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIP.has(dirent.name)) queue.push({ dir: full, depth: depth + 1 })
      } else if (dirent.isFile() && TEMP_PATTERNS.some((re) => re.test(dirent.name))) {
        out.push(toEntry(full, await fsp.lstat(full)))
        if (out.length >= 2000) return out
      }
    }
  }
  return out
}

const INSTALLER_EXTS = new Set(['dmg', 'pkg', 'iso'])

/** Disk images / installers untouched for `olderThanDays` in the root. */
export async function findOldInstallers(root: string, olderThanDays: number, ctx: WalkContext): Promise<FileEntry[]> {
  const cutoff = Date.now() - olderThanDays * 86_400_000
  const out: FileEntry[] = []
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  let visited = 0
  while (queue.length > 0) {
    if (ctx.isCancelled()) throw new AppError('CANCELLED', 'Scan cancelled.')
    const { dir, depth } = queue.shift()!
    if (++visited > WALK_CAP) break
    if (visited % 100 === 0) ctx.onProgress(out.length, dir)
    let dirents
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const dirent of dirents) {
      const full = path.join(dir, dirent.name)
      if (dirent.isDirectory()) {
        if (depth < 3 && !SKIP.has(dirent.name)) queue.push({ dir: full, depth: depth + 1 })
      } else if (dirent.isFile()) {
        const ext = dirent.name.split('.').pop()?.toLowerCase() ?? ''
        if (!INSTALLER_EXTS.has(ext)) continue
        const stat = await fsp.lstat(full).catch(() => null)
        if (stat && stat.mtimeMs < cutoff) {
          out.push(toEntry(full, stat))
          if (out.length >= 1000) return out
        }
      }
    }
  }
  out.sort((a, b) => a.modifiedAt - b.modifiedAt)
  return out
}

/** Top-level children of a cache root with sizes (review-only cleaner). */
export async function analyzeCacheRoot(root: string, ctx: WalkContext): Promise<CacheItem[]> {
  const measure = async (dir: string): Promise<{ bytes: number; truncated: boolean }> => {
    let bytes = 0
    let truncated = false
    const queue: Array<{ dir: string; depth: number }> = [{ dir, depth: 0 }]
    let files = 0
    while (queue.length > 0) {
      if (ctx.isCancelled()) throw new AppError('CANCELLED', 'Scan cancelled.')
      const { dir: d, depth } = queue.shift()!
      if (files > 20_000) {
        truncated = true
        break
      }
      let dirents
      try {
        dirents = await fsp.readdir(d, { withFileTypes: true })
      } catch {
        continue
      }
      for (const dirent of dirents) {
        const full = path.join(d, dirent.name)
        if (dirent.isDirectory()) {
          if (depth < 6) queue.push({ dir: full, depth: depth + 1 })
        } else if (dirent.isFile()) {
          files++
          bytes += (await fsp.stat(full).then((s) => s.size, () => 0))
        }
      }
    }
    return { bytes, truncated }
  }

  let dirents
  try {
    dirents = await fsp.readdir(root, { withFileTypes: true })
  } catch (error) {
    throw error
  }
  const items: CacheItem[] = []
  for (const dirent of dirents) {
    if (ctx.isCancelled()) throw new AppError('CANCELLED', 'Scan cancelled.')
    if (!dirent.isDirectory()) continue
    const full = path.join(root, dirent.name)
    try {
      const size = await measure(full)
      items.push({ path: full, name: dirent.name, bytes: size.bytes, truncated: size.truncated })
    } catch {
      // unreadable cache dir — skip
    }
  }
  items.sort((a, b) => b.bytes - a.bytes)
  return items
}

/**
 * Duplicate folder detector: group directories by (fileCount, totalBytes),
 * then verify candidates by comparing relative paths + streamed head hashes.
 * Outermost duplicates only; bounded per-folder file cap.
 */
export async function findDuplicateFolders(
  root: string,
  ctx: WalkContext,
  hashHead: (file: string) => Promise<string>
): Promise<DuplicateFolderGroup[]> {
  const MAX_FILES_PER_FOLDER = 300
  const signatureOf = async (
    dir: string
  ): Promise<{ fileCount: number; bytes: number; skipped: boolean }> => {
    let fileCount = 0
    let bytes = 0
    const skipped = false
    const queue: Array<{ dir: string; depth: number }> = [{ dir, depth: 0 }]
    while (queue.length > 0) {
      if (ctx.isCancelled()) throw new AppError('CANCELLED', 'Scan cancelled.')
      const { dir: d, depth } = queue.shift()!
      let dirents
      try {
        dirents = await fsp.readdir(d, { withFileTypes: true })
      } catch {
        continue
      }
      for (const dirent of dirents) {
        const full = path.join(d, dirent.name)
        if (dirent.isDirectory()) {
          if (depth < 6 && !SKIP.has(dirent.name)) queue.push({ dir: full, depth: depth + 1 })
        } else if (dirent.isFile()) {
          fileCount++
          if (fileCount > MAX_FILES_PER_FOLDER) return { fileCount, bytes, skipped: true }
          bytes += await fsp.stat(full).then((s) => s.size, () => 0)
        }
      }
    }
    return { fileCount, bytes, skipped }
  }

  // Collect candidate directories (depth-limited), record outermost.
  const candidates: string[] = []
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  let visited = 0
  while (queue.length > 0) {
    if (ctx.isCancelled()) throw new AppError('CANCELLED', 'Scan cancelled.')
    const { dir, depth } = queue.shift()!
    if (++visited > 15_000) break
    if (visited % 50 === 0) ctx.onProgress(visited, dir)
    let dirents
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue
      const full = path.join(dir, dirent.name)
      if (SKIP.has(dirent.name) || dirent.name.startsWith('.')) continue
      candidates.push(full)
      if (depth < 5) queue.push({ dir: full, depth: depth + 1 })
    }
  }

  const bySignature = new Map<string, string[]>()
  const sigByFolder = new Map<string, { fileCount: number; bytes: number }>()
  let done = 0
  for (const candidate of candidates) {
    if (ctx.isCancelled()) throw new AppError('CANCELLED', 'Scan cancelled.')
    const sig = await signatureOf(candidate)
    done++
    if (done % 25 === 0) ctx.onProgress(done, candidate)
    if (sig.skipped || sig.fileCount === 0) continue
    sigByFolder.set(candidate, { fileCount: sig.fileCount, bytes: sig.bytes })
    const key = `${sig.fileCount}:${sig.bytes}`
    const list = bySignature.get(key)
    if (list) list.push(candidate)
    else bySignature.set(key, [candidate])
  }

  // Verify same-signature groups by content fingerprint (relpath:headhash).
  const groups: DuplicateFolderGroup[] = []
  for (const list of bySignature.values()) {
    if (list.length < 2) continue
    const fingerprints = new Map<string, string[]>()
    for (const folder of list) {
      if (ctx.isCancelled()) throw new AppError('CANCELLED', 'Scan cancelled.')
      const parts: string[] = []
      const inner: Array<{ dir: string; rel: string }> = [{ dir: folder, rel: '' }]
      let count = 0
      let ok = true
      while (inner.length > 0 && count <= MAX_FILES_PER_FOLDER) {
        const { dir, rel } = inner.shift()!
        let dirents
        try {
          dirents = await fsp.readdir(dir, { withFileTypes: true })
        } catch {
          ok = false
          break
        }
        for (const dirent of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
          const childRel = rel ? `${rel}/${dirent.name}` : dirent.name
          if (dirent.isDirectory()) {
            if (!SKIP.has(dirent.name)) inner.push({ dir: path.join(dir, dirent.name), rel: childRel })
          } else if (dirent.isFile()) {
            count++
            if (count > MAX_FILES_PER_FOLDER) {
              ok = false
              break
            }
            const head = await hashHead(path.join(dir, dirent.name)).catch(() => 'ERR')
            parts.push(`${childRel}:${head}`)
          }
        }
      }
      if (!ok) continue
      const key = parts.join('\n')
      const list2 = fingerprints.get(key)
      if (list2) list2.push(folder)
      else fingerprints.set(key, [folder])
    }
    for (const matches of fingerprints.values()) {
      if (matches.length > 1) {
        const sig = sigByFolder.get(matches[0]) ?? { fileCount: 0, bytes: 0 }
        groups.push({ paths: [...matches].sort(), fileCount: sig.fileCount, bytes: sig.bytes })
      }
    }
  }
  groups.sort((a, b) => b.bytes * b.paths.length - a.bytes * a.paths.length)
  return groups
}
