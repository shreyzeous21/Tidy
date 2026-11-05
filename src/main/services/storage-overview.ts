import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Stats } from 'node:fs'
import type { StorageOverview, VolumeUsage } from '@shared/types/info'
import type { DownloadCategory } from '@shared/types/files'
import { categoryForFile } from '@shared/constants/categories'
import { AppError } from '../utils/errors'

/**
 * Storage overview: volume usage via statfs, plus a bounded walk of the
 * given root computing largest top-level folders and a size breakdown by
 * file category. All work is async I/O with hard caps — the main process
 * never blocks.
 */

const WALK_FILE_CAP = 60_000
const MAX_DEPTH = 3

const SKIP_DIR_NAMES = new Set([
  'node_modules', '.git', '.Trash', 'Library', '__pycache__', '.venv', 'DerivedData', '.npm',
  'Caches', '.cache'
])

async function volumeUsage(volumePath: string): Promise<VolumeUsage | null> {
  try {
    const stats = await fsp.statfs(volumePath)
    const blockSize = Number(stats.bsize)
    const total = Number(stats.blocks) * blockSize
    const free = Number(stats.bavail) * blockSize
    return {
      path: volumePath,
      name: volumePath === '/' ? 'Macintosh HD' : path.basename(volumePath),
      total,
      free,
      used: Math.max(total - free, 0)
    }
  } catch {
    return null
  }
}

interface WalkTotals {
  folders: Map<string, number>
  categories: Map<DownloadCategory, number>
  truncated: boolean
}

async function walkForOverview(
  root: string,
  isCancelled: () => boolean,
  onProgress: (processed: number, currentPath: string) => void
): Promise<WalkTotals> {
  const folders = new Map<string, number>()
  const categories = new Map<DownloadCategory, number>()
  let truncated = false
  let processed = 0
  let visited = 0

  // Depth-limited BFS from the root's direct children; every file's size is
  // attributed to its top-level folder and to its category.
  let topDirents
  try {
    topDirents = await fsp.readdir(root, { withFileTypes: true })
  } catch (error) {
    throw error
  }

  for (const dirent of topDirents) {
    if (isCancelled()) throw new AppError('CANCELLED', 'Scan cancelled.')
    const topPath = path.join(root, dirent.name)
    if (dirent.isFile()) {
      try {
        const stat = await fsp.stat(topPath)
        folders.set(topPath, (folders.get(topPath) ?? 0) + stat.size)
        const cat = categoryForFile(dirent.name)
        categories.set(cat, (categories.get(cat) ?? 0) + stat.size)
        processed++
      } catch {
        // unreadable — skip
      }
      continue
    }
    if (!dirent.isDirectory() || SKIP_DIR_NAMES.has(dirent.name)) continue

    const queue: Array<{ dir: string; depth: number }> = [{ dir: topPath, depth: 1 }]
    let topBytes = 0
    while (queue.length > 0) {
      if (isCancelled()) throw new AppError('CANCELLED', 'Scan cancelled.')
      const { dir, depth } = queue.shift()!
      if (++visited > WALK_FILE_CAP) {
        truncated = true
        break
      }
      let dirents
      try {
        dirents = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const child of dirents) {
        const full = path.join(dir, child.name)
        if (child.isDirectory()) {
          if (depth < MAX_DEPTH && !SKIP_DIR_NAMES.has(child.name)) queue.push({ dir: full, depth: depth + 1 })
        } else if (child.isFile()) {
          try {
            const stat: Stats = await fsp.stat(full)
            topBytes += stat.size
            const cat = categoryForFile(child.name)
            categories.set(cat, (categories.get(cat) ?? 0) + stat.size)
            processed++
            if (processed % 250 === 0) onProgress(processed, full)
          } catch {
            // unreadable — skip
          }
        }
      }
    }
    folders.set(topPath, topBytes)
  }

  return { folders, categories, truncated }
}

export async function getStorageOverview(
  root: string,
  isCancelled: () => boolean,
  onProgress: (processed: number, currentPath: string) => void
): Promise<StorageOverview> {
  const volumes: VolumeUsage[] = []
  const boot = await volumeUsage('/')
  if (boot) volumes.push(boot)
  try {
    const volEntries = await fsp.readdir('/Volumes', { withFileTypes: true })
    for (const entry of volEntries) {
      if (!entry.isDirectory() || entry.name === 'Macintosh HD') continue
      const usage = await volumeUsage(path.join('/Volumes', entry.name))
      if (usage) volumes.push(usage)
    }
  } catch {
    // /Volumes unreadable — boot volume only
  }

  const scanRoot = root === '~' ? os.homedir() : root
  const { folders, categories, truncated } = await walkForOverview(scanRoot, isCancelled, onProgress)

  const largestFolders = [...folders.entries()]
    .map(([p, bytes]) => ({ path: p, bytes }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 12)

  const categoryRows = [...categories.entries()]
    .map(([category, bytes]) => ({ category, bytes }))
    .filter((row) => row.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes)

  return { volumes, largestFolders, categories: categoryRows, truncated }
}
