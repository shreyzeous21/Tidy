import { create } from 'zustand'
import type { AppSettings, ThemePreference } from '@shared/types/settings'
import { tidy, unwrap } from '@/lib/api'

/** Top-level view identifiers (sidebar order). */
export type ViewId =
  | 'home'
  | 'overview'
  | 'files'
  | 'downloads'
  | 'apps'
  | 'search'
  | 'cleanup'
  | 'trash'
  | 'settings'

export const VIEW_TITLES: Record<ViewId, string> = {
  home: 'Home',
  overview: 'Overview',
  files: 'Files',
  downloads: 'Downloads',
  apps: 'Apps',
  search: 'Search',
  cleanup: 'Clean Up',
  trash: 'Trash',
  settings: 'Settings'
}

interface AppState {
  view: ViewId
  settings: AppSettings | null
  watchedDir: string | null
  /** Incremented to move keyboard focus into the Search input. */
  searchFocusSignal: number
  /** Incremented to open Quick Move in the Files view. */
  quickMoveSignal: number
  /** Incremented to open the Get Info panel for the Files selection. */
  getInfoSignal: number
  /** Incremented to open the command palette. */
  paletteSignal: number
  /** A saved search waiting to be applied by the Search view. */
  seedSearch: { id: number; data: AppSettings['savedSearches'][number] } | null
  /** Whether the macOS permission onboarding dialog is open. */
  permissionsOpen: boolean

  setView: (view: ViewId) => void
  loadSettings: () => Promise<void>
  patchSettings: (patch: Partial<AppSettings>) => Promise<void>
  setWatchedDir: (dir: string | null) => void
  focusSearch: () => void
  requestQuickMove: () => void
  requestGetInfo: () => void
  openPalette: () => void
  openPermissions: () => void
  closePermissions: () => void
  applySavedSearch: (data: AppSettings['savedSearches'][number]) => void
  clearSeedSearch: () => void
}

export const useAppStore = create<AppState>((set, get) => ({
  view: 'home',
  settings: null,
  watchedDir: null,
  searchFocusSignal: 0,
  quickMoveSignal: 0,
  getInfoSignal: 0,
  paletteSignal: 0,
  seedSearch: null,
  permissionsOpen: false,

  setView: (view) => set({ view }),

  loadSettings: async () => {
    const settings = await unwrap(tidy().getSettings())
    set({ settings })
  },

  patchSettings: async (patch) => {
    const current = get().settings
    // Optimistic update keeps toggles snappy; main is the source of truth.
    if (current) set({ settings: { ...current, ...patch } })
    const settings = await unwrap(tidy().updateSettings(patch))
    set({ settings })
  },

  setWatchedDir: (watchedDir) => set({ watchedDir }),
  focusSearch: () => set((s) => ({ searchFocusSignal: s.searchFocusSignal + 1 })),
  requestQuickMove: () => set((s) => ({ quickMoveSignal: s.quickMoveSignal + 1 })),
  requestGetInfo: () => set((s) => ({ getInfoSignal: s.getInfoSignal + 1 })),
  openPalette: () => set((s) => ({ paletteSignal: s.paletteSignal + 1 })),
  openPermissions: () => set({ permissionsOpen: true }),
  closePermissions: () => set({ permissionsOpen: false }),
  applySavedSearch: (data) =>
    set({ seedSearch: { id: Date.now(), data }, view: 'search' }),
  clearSeedSearch: () => set({ seedSearch: null })
}))

/** Apply a theme preference to the document root, resolving `system`. */
export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = preference === 'dark' || (preference === 'system' && systemDark)
  root.classList.toggle('dark', dark)
}

/** React to OS appearance changes while following the system setting. */
export function watchSystemTheme(getPreference: () => ThemePreference): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const listener = (): void => applyTheme(getPreference())
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}
