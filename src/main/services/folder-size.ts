import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '../utils/errors'

/**
 * Bounded recursive size computation for a single folder.
 * Used by "Calculate Size" in the Files browser — hard caps keep this
 * predictable on huge trees.
 */

const FILE_CAP = 30_000
const MAX_DEPTH = 10

const SKIP_DIR_NAMES = new Set(['node_modules', '.git', '.Trash', 'Library', '__pycache__'])

export interface FolderSizeResult {
  bytes: number
  files: number
  truncated: boolean
}

export async function computeFolderSize(root: string): Promise<FolderSizeResult> {
  let rootStat
  try {
    rootStat = await fsp.stat(root)
  } catch {
    throw new AppError('NOT_FOUND', 'The folder no longer exists.')
  }
  if (!rootStat.isDirectory()) {
    throw new AppError('INVALID_INPUT', 'Size can only be calculated for folders.')
  }

  let bytes = 0
  let files = 0
  let truncated = false
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]

  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!
    if (files > FILE_CAP) {
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
      const full = path.join(dir, dirent.name)
      if (dirent.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIP_DIR_NAMES.has(dirent.name)) queue.push({ dir: full, depth: depth + 1 })
      } else if (dirent.isFile()) {
        files++
        try {
          bytes += (await fsp.stat(full)).size
        } catch {
          // unreadable — count the entry, not the bytes
        }
        if (files > FILE_CAP) {
          truncated = true
          break
        }
      }
    }
  }

  return { bytes, files, truncated }
}
