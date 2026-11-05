import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { FileEntry } from '@shared/types/files'

/**
 * macOS-specific read-mostly utilities: application leftovers, login items,
 * launch agents. Heuristics are honest and everything is review-only
 * (trash always requires the explicit confirmation dialog downstream).
 */

/** Application Support folders whose name doesn't match any installed app. */
export async function findAppLeftovers(
  installed: Array<{ name: string; path: string }>,
  isCancelled: () => boolean
): Promise<FileEntry[]> {
  const supportDir = path.join(os.homedir(), 'Library', 'Application Support')
  const norm = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '')
  const known = new Set<string>()
  for (const app of installed) {
    known.add(norm(app.name))
    // Also index bundle-id-ish path segments, e.g. com.apple.Safari.
    for (const segment of app.path.split('/')) known.add(norm(segment))
  }
  known.add('comapplesharedfilelist')
  known.add('mobilemeaccounts')
  known.add('knowledge')
  known.add('syncservices')
  known.add('addressbook')
  known.add('callhistorytransactions')
  known.add('cookies')
  known.add('systempreferences')

  const candidates: FileEntry[] = []
  let dirents
  try {
    dirents = await fsp.readdir(supportDir, { withFileTypes: true })
  } catch {
    return []
  }
  for (const dirent of dirents) {
    if (isCancelled()) break
    if (!dirent.isDirectory()) continue
    const name = dirent.name
    const normalized = norm(name)
    let matched = false
    for (const k of known) {
      if (k.length >= 4 && (normalized.includes(k) || k.includes(normalized))) {
        matched = true
        break
      }
    }
    if (!matched) {
      candidates.push({
        name,
        path: path.join(supportDir, name),
        isDirectory: true,
        isSymlink: false,
        size: 0,
        modifiedAt: 0,
        kind: 'other',
        extension: ''
      })
      if (candidates.length >= 300) break
    }
  }
  return candidates
}

function exec(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { shell: false, timeout: 10_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

/** Login items via System Events (may prompt for Automation permission). */
export async function listLoginItems(): Promise<string[]> {
  try {
    const out = await exec(
      '/usr/bin/osascript',
      ['-e', 'tell application "System Events" to get the name of every login item']
    )
    return out.split(',').map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

export interface LaunchAgentInfo {
  path: string
  label: string
  program: string
}

/** Launch agents from user + local domains, parsed via plutil. */
export async function listLaunchAgents(): Promise<LaunchAgentInfo[]> {
  const dirs = [
    path.join(os.homedir(), 'Library', 'LaunchAgents'),
    '/Library/LaunchAgents'
  ]
  const agents: LaunchAgentInfo[] = []
  for (const dir of dirs) {
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.plist')) continue
      const full = path.join(dir, entry.name)
      try {
        const json = await exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', full])
        const parsed = JSON.parse(json) as { Label?: string; Program?: string; ProgramArguments?: string[] }
        agents.push({
          path: full,
          label: parsed.Label ?? entry.name,
          program: parsed.Program ?? parsed.ProgramArguments?.[0] ?? ''
        })
      } catch {
        agents.push({ path: full, label: entry.name, program: '' })
      }
    }
  }
  return agents
}
