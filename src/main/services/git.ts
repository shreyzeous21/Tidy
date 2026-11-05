import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { RepoInfo } from '@shared/types/cleanup'
import { AppError } from '../utils/errors'
import { computeFolderSize } from './folder-size'

/**
 * Git repository dashboard via the system /usr/bin/git — fixed executable,
 * argv-array arguments, never a shell string. Read-only operations only.
 */

const GIT = '/usr/bin/git'

function git(args: string[], cwd?: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(GIT, args, { cwd, timeout: timeoutMs, shell: false, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(new AppError('UNKNOWN', error.message))
      else resolve(stdout)
    })
  })
}

/** Parsed porcelain status — pure, unit-tested. */
export function parsePorcelain(output: string): { branch: string; modified: number; untracked: number } {
  let branch = ''
  let modified = 0
  let untracked = 0
  for (const line of output.split('\n')) {
    if (!line) continue
    if (line.startsWith('##')) {
      const match = /\?\?\s|\.{3}\S+/.exec(line)
      branch = line.replace(/^##\s*/, '').replace(/\.\.\.\S+/, '').replace(/\s*\[.*/, '').trim() || '(detached)'
      void match
    } else if (line.startsWith('??')) {
      untracked++
    } else {
      modified++
    }
  }
  return { branch, modified, untracked }
}

/** Repos under a root (outermost only), with status + .git size. */
export async function scanRepositories(
  root: string,
  isCancelled: () => boolean,
  onProgress: (visited: number, currentPath: string) => void,
  statusDetail: boolean
): Promise<RepoInfo[]> {
  const repos: string[] = []
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  let visited = 0
  const SKIP = new Set(['node_modules', '.Trash', 'Library'])

  while (queue.length > 0) {
    if (isCancelled()) throw new AppError('CANCELLED', 'Scan cancelled.')
    const { dir, depth } = queue.shift()!
    if (++visited > 20_000) break
    if (visited % 50 === 0) onProgress(visited, dir)
    let dirents
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    let foundHere = false
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue
      const full = path.join(dir, dirent.name)
      if (dirent.name === '.git') {
        repos.push(dir)
        foundHere = true
        break
      }
      if (depth < 6 && !SKIP.has(dirent.name)) queue.push({ dir: full, depth: depth + 1 })
    }
    void foundHere
  }

  const infos: RepoInfo[] = []
  for (const repo of repos.slice(0, 150)) {
    if (isCancelled()) throw new AppError('CANCELLED', 'Scan cancelled.')
    onProgress(repos.length + 1, repo)
    const info: RepoInfo = {
      path: repo,
      name: path.basename(repo),
      branch: '',
      modified: 0,
      untracked: 0,
      lastCommit: '',
      gitBytes: 0,
      truncated: false
    }
    try {
      const gitDirSize = await computeFolderSize(path.join(repo, '.git'))
      info.gitBytes = gitDirSize.bytes
      info.truncated = gitDirSize.truncated
    } catch {
      // unreadable .git
    }
    if (statusDetail) {
      try {
        const status = await git(['status', '--porcelain=v1', '-b'], repo)
        const parsed = parsePorcelain(status)
        info.branch = parsed.branch
        info.modified = parsed.modified
        info.untracked = parsed.untracked
      } catch {
        info.branch = '(unreadable)'
      }
      try {
        const log = await git(['log', '-1', '--format=%cs %s'], repo)
        info.lastCommit = log.trim().slice(0, 120)
      } catch {
        info.lastCommit = 'no commits yet'
      }
    }
    infos.push(info)
  }
  infos.sort((a, b) => b.gitBytes - a.gitBytes)
  return infos
}

/** Full porcelain status lines for one repo (capped). */
export async function repoStatus(repo: string): Promise<string[]> {
  const out = await git(['status', '--porcelain=v1', '-b'], repo)
  return out.split('\n').filter(Boolean).slice(0, 300)
}
