import fsp from 'node:fs/promises'
import path from 'node:path'
import type { DevArtifact } from '@shared/types/cleanup'
import { AppError } from '../utils/errors'

/**
 * Development artifact finder: the regeneratable directories every
 * developer deletes first — node_modules, DerivedData, build output, and
 * friends. Only the *outermost* artifact is reported (a node_modules inside
 * a node_modules is never listed separately), and artifacts are never
 * traversed into while searching.
 *
 * Electron-free so it can be unit-tested directly.
 */

export const ARTIFACT_NAMES = new Set([
  'node_modules',
  '.gradle',
  'gradle-app.setting',
  'DerivedData',
  'build',
  'dist',
  'target',
  '.next',
  '.nuxt',
  '.output',
  'vendor',
  'Pods',
  '.terraform',
  '__pycache__',
  '.venv',
  'venv',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.turbo',
  '.parcel-cache',
  '.dart_tool',
  'Debug',
  'Release'
])

const TRAVERSAL_SKIP = new Set(['.git', '.Trash', 'Library', '.svn'])

const DIR_VISIT_CAP = 40_000
const MAX_DEPTH = 8

export async function scanDevArtifacts(
  root: string,
  isCancelled: () => boolean,
  onProgress: (visited: number, currentPath: string) => void,
  measureSize: (dir: string) => Promise<{ bytes: number; truncated: boolean }>
): Promise<DevArtifact[]> {
  let rootStat
  try {
    rootStat = await fsp.stat(root)
  } catch {
    throw new AppError('NOT_FOUND', 'The folder no longer exists.')
  }
  if (!rootStat.isDirectory()) {
    throw new AppError('INVALID_INPUT', 'Scanning needs a folder.')
  }

  const found: Array<{ path: string; name: string }> = []
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  let visited = 0

  while (queue.length > 0) {
    if (isCancelled()) throw new AppError('CANCELLED', 'Scan cancelled.')
    const { dir, depth } = queue.shift()!
    if (++visited > DIR_VISIT_CAP) break
    if (visited % 50 === 0) onProgress(visited, dir)

    let dirents
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue
      const full = path.join(dir, dirent.name)
      if (depth < MAX_DEPTH && ARTIFACT_NAMES.has(dirent.name)) {
        // Record the outermost artifact only; never descend into it.
        found.push({ path: full, name: dirent.name })
      } else if (depth < MAX_DEPTH && !TRAVERSAL_SKIP.has(dirent.name) && !dirent.name.startsWith('.')) {
        queue.push({ dir: full, depth: depth + 1 })
      }
    }
  }

  // Measure each artifact with the caller's bounded size walker.
  const artifacts: DevArtifact[] = []
  for (let index = 0; index < found.length; index++) {
    if (isCancelled()) throw new AppError('CANCELLED', 'Scan cancelled.')
    onProgress(found.length + index + 1, found[index].path)
    try {
      const size = await measureSize(found[index].path)
      artifacts.push({ ...found[index], bytes: size.bytes, truncated: size.truncated })
    } catch {
      artifacts.push({ ...found[index], bytes: 0, truncated: true })
    }
  }

  artifacts.sort((a, b) => b.bytes - a.bytes)
  onProgress(found.length * 2, '')
  return artifacts
}
