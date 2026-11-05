import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { AppSettings, OperationHistoryItem } from '@shared/types/settings'

/**
 * Small JSON-file persistence under Electron's userData directory.
 * No file contents are ever stored — only settings and a bounded action history.
 */

const SETTINGS_FILE = 'settings.json'
const HISTORY_FILE = 'history.json'
const HISTORY_LIMIT = 200

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  accent: 'blue',
  pinnedFolders: [],
  recentDestinations: [],
  largeFileThresholdMB: 100,
  duplicateMinSizeMB: 1,
  downloadsDestinations: {},
  approvedRoots: [],
  showHiddenFiles: false,
  recentSearches: [],
  savedSearches: [],
  orgRules: [],
  onboardingCompleted: false
}

function userDataDir(): string {
  return app.getPath('userData')
}

function resolveDataFile(name: string): string {
  return path.join(userDataDir(), name)
}

/** Atomic JSON write: temp file + rename so a crash never corrupts data. */
async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await fsp.rename(tmp, file)
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fsp.readFile(file, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function loadSettings(): Promise<AppSettings> {
  const stored = await readJson<Partial<AppSettings>>(resolveDataFile(SETTINGS_FILE))
  if (!stored) return { ...DEFAULT_SETTINGS }
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    // Arrays/objects from an older schema must never be partial garbage.
    pinnedFolders: Array.isArray(stored.pinnedFolders) ? stored.pinnedFolders : [],
    recentDestinations: Array.isArray(stored.recentDestinations) ? stored.recentDestinations : [],
    approvedRoots: Array.isArray(stored.approvedRoots) ? stored.approvedRoots : [],
    recentSearches: Array.isArray(stored.recentSearches) ? stored.recentSearches : [],
    savedSearches: Array.isArray(stored.savedSearches) ? stored.savedSearches : [],
    orgRules: Array.isArray(stored.orgRules) ? stored.orgRules : [],
    downloadsDestinations:
      stored.downloadsDestinations && typeof stored.downloadsDestinations === 'object'
        ? stored.downloadsDestinations
        : {}
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await writeJsonAtomic(resolveDataFile(SETTINGS_FILE), settings)
}

export async function resetSettings(): Promise<AppSettings> {
  const fresh = { ...DEFAULT_SETTINGS }
  await saveSettings(fresh)
  return fresh
}

export async function loadHistory(): Promise<OperationHistoryItem[]> {
  const stored = await readJson<OperationHistoryItem[]>(resolveDataFile(HISTORY_FILE))
  return Array.isArray(stored) ? stored : []
}

export async function appendHistory(item: Omit<OperationHistoryItem, 'id' | 'at'>): Promise<void> {
  const history = await loadHistory()
  const entry: OperationHistoryItem = {
    ...item,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString()
  }
  const next = [entry, ...history].slice(0, HISTORY_LIMIT)
  await writeJsonAtomic(resolveDataFile(HISTORY_FILE), next)
}

export async function clearHistory(): Promise<void> {
  await writeJsonAtomic(resolveDataFile(HISTORY_FILE), [])
}
