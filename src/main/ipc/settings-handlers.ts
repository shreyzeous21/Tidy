import { ipcMain } from 'electron'
import { app } from 'electron'
import type { AppSettings } from '@shared/types/settings'
import { guard } from '../utils/errors'
import { normalizePath } from '../utils/path-validation'
import { clearHistory, resetSettings } from '../services/storage'
import { getHistoryWithUndo } from '../services/usage-history'
import { mdfindAvailable } from '../services/search'
import { homePath } from '../services/filesystem'
import type { HandlerContext } from './context'

/** Settings, history, and app-info IPC handlers. */

const THEME_VALUES = new Set(['system', 'light', 'dark'])

/** Whitelist-based patch sanitizer: unknown or malformed keys are dropped. */
function sanitizePatch(patch: unknown): Partial<AppSettings> {
  if (!patch || typeof patch !== 'object') return {}
  const out: Partial<AppSettings> = {}
  const p = patch as Record<string, unknown>

  if (typeof p.theme === 'string' && THEME_VALUES.has(p.theme)) {
    out.theme = p.theme as AppSettings['theme']
  }
  if (
    typeof p.accent === 'string' &&
    ['blue', 'teal', 'purple', 'rose', 'orange', 'graphite'].includes(p.accent)
  ) {
    out.accent = p.accent as AppSettings['accent']
  }
  if (Array.isArray(p.pinnedFolders)) {
    out.pinnedFolders = p.pinnedFolders
      .filter((f): f is string => typeof f === 'string')
      .slice(0, 20)
      .map((f) => normalizePath(f, 'pinned folder'))
  }
  if (typeof p.largeFileThresholdMB === 'number' && p.largeFileThresholdMB > 0) {
    out.largeFileThresholdMB = Math.min(p.largeFileThresholdMB, 100_000)
  }
  if (typeof p.duplicateMinSizeMB === 'number' && p.duplicateMinSizeMB >= 0) {
    out.duplicateMinSizeMB = Math.min(p.duplicateMinSizeMB, 100_000)
  }
  if (typeof p.showHiddenFiles === 'boolean') {
    out.showHiddenFiles = p.showHiddenFiles
  }
  if (typeof p.onboardingCompleted === 'boolean') {
    out.onboardingCompleted = p.onboardingCompleted
  }
  if (Array.isArray(p.recentSearches)) {
    out.recentSearches = p.recentSearches
      .filter((q): q is string => typeof q === 'string' && q.length > 0 && q.length <= 300)
      .slice(0, 10)
  }
  if (Array.isArray(p.savedSearches)) {
    out.savedSearches = p.savedSearches
      .filter(
        (s): s is AppSettings['savedSearches'][number] =>
          !!s && typeof s === 'object' && typeof (s as { name?: unknown }).name === 'string'
      )
      .slice(0, 20)
      .map((s) => ({ ...s, name: s.name.slice(0, 80) }))
  }
  if (Array.isArray(p.orgRules)) {
    out.orgRules = p.orgRules
      .filter(
        (r): r is AppSettings['orgRules'][number] =>
          !!r &&
          typeof r === 'object' &&
          typeof r.id === 'string' &&
          typeof r.destination === 'string'
      )
      .slice(0, 30)
      .map((r) => ({
        ...r,
        enabled: r.enabled === true,
        nameContains: typeof r.nameContains === 'string' ? r.nameContains.slice(0, 120) : '',
        destination: normalizePath(r.destination, 'rule destination')
      }))
  }
  if (p.downloadsDestinations && typeof p.downloadsDestinations === 'object') {
    const entries = Object.entries(p.downloadsDestinations as Record<string, unknown>)
    const valid: AppSettings['downloadsDestinations'] = {}
    for (const [key, value] of entries) {
      if (typeof value === 'string' && value.length > 0) {
        valid[key as keyof AppSettings['downloadsDestinations']] = normalizePath(value, 'destination')
      }
    }
    out.downloadsDestinations = valid
  }
  if (Array.isArray(p.recentDestinations)) {
    // Recent destinations are maintained by the main process on moves; the
    // renderer may not inject arbitrary values, so this is accepted as a
    // bounded, validated list only.
    out.recentDestinations = p.recentDestinations
      .filter((f): f is string => typeof f === 'string')
      .slice(0, 6)
      .map((f) => normalizePath(f, 'destination'))
  }
  // approvedRoots are intentionally NOT settable from the renderer;
  // they only grow through fs:pick-folder.
  return out
}

export function registerSettingsHandlers(ctx: HandlerContext): void {
  ipcMain.handle('settings:get', () => guard(async () => ctx.settings))

  ipcMain.handle('settings:update', (_event, patch: unknown) =>
    guard(async () => {
      const safePatch = sanitizePatch(patch)
      const next: AppSettings = { ...ctx.settings, ...safePatch }
      await ctx.persist(next)
      return next
    })
  )

  ipcMain.handle('settings:reset', () =>
    guard(async () => {
      const fresh = await resetSettings()
      ctx.settings = fresh
      return fresh
    })
  )

  ipcMain.handle('history:get', () => guard(() => getHistoryWithUndo()))
  ipcMain.handle('history:clear', () =>
    guard(async () => {
      await clearHistory()
    })
  )

  ipcMain.handle('app:info', () =>
    guard(async () => ({
      versions: {
        app: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node
      },
      platform: process.platform,
      homePath: homePath(),
      mdfindAvailable: mdfindAvailable()
    }))
  )
}
