import { create } from 'zustand'
import type { AppInfo } from '@shared/types/cleanup'
import type { FileEntry, FileKind, FolderInfo, SortDirection, SortKey } from '@shared/types/files'
import type { SystemInfo } from '@shared/types/info'
import { dirName } from '@/lib/format'

/** One browser tab: its own location, history, listing, and view options. */
export interface BrowserTab {
  id: string
  path: string | null
  history: string[]
  future: string[]
  entries: FileEntry[]
  loading: boolean
  error: { code: string; message: string } | null
  sort: { key: SortKey; direction: SortDirection }
  kindFilter: FileKind | 'all'
  refreshToken: number
}

function newTab(id: string): BrowserTab {
  return {
    id,
    path: null,
    history: [],
    future: [],
    entries: [],
    loading: false,
    error: null,
    sort: { key: 'name', direction: 'asc' },
    kindFilter: 'all',
    refreshToken: 0
  }
}

const makeTabId = (): string => `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

interface BrowserState {
  tabs: BrowserTab[]
  activeTabId: string

  // Tab management
  newTab: (path?: string) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void

  // Active-tab navigation (mirrors the previous single-tab API)
  navigate: (path: string) => void
  back: () => void
  forward: () => void
  goUp: () => void
  refresh: () => void
  setEntries: (entries: FileEntry[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: BrowserTab['error']) => void
  setSort: (key: SortKey) => void
  setKindFilter: (filter: FileKind | 'all') => void
}

export const useBrowserStore = create<BrowserState>((set, get) => {
  const updateActive = (patch: (tab: BrowserTab) => Partial<BrowserTab>): void => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === state.activeTabId ? { ...tab, ...patch(tab) } : tab
      )
    }))
  }

  return {
    tabs: [newTab('tab-1')],
    activeTabId: 'tab-1',

    newTab: (path) => {
      const tab = newTab(makeTabId())
      if (path) tab.path = path
      set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }))
    },

    closeTab: (id) => {
      set((state) => {
        if (state.tabs.length === 1) {
          // Closing the last tab resets it instead of leaving the browser empty.
          const fresh = newTab(state.tabs[0].id)
          return { tabs: [fresh] }
        }
        const index = state.tabs.findIndex((tab) => tab.id === id)
        const tabs = state.tabs.filter((tab) => tab.id !== id)
        let activeTabId = state.activeTabId
        if (id === state.activeTabId) {
          activeTabId = tabs[Math.min(index, tabs.length - 1)].id
        }
        return { tabs, activeTabId }
      })
    },

    setActiveTab: (id) => set({ activeTabId: id }),

    navigate: (path) => {
      const state = get()
      const tab = state.tabs.find((t) => t.id === state.activeTabId)
      if (!tab || path === tab.path) return
      updateActive((t) => ({
        path,
        history: t.path ? [...t.history, t.path].slice(-100) : t.history,
        future: [],
        entries: [],
        loading: true,
        error: null
      }))
    },

    back: () => {
      const state = get()
      const tab = state.tabs.find((t) => t.id === state.activeTabId)
      if (!tab || tab.history.length === 0) return
      const previous = tab.history[tab.history.length - 1]
      updateActive((t) => ({
        path: previous,
        history: t.history.slice(0, -1),
        future: t.path ? [t.path, ...t.future].slice(0, 100) : t.future,
        entries: [],
        loading: true,
        error: null
      }))
    },

    forward: () => {
      const state = get()
      const tab = state.tabs.find((t) => t.id === state.activeTabId)
      if (!tab || tab.future.length === 0) return
      const next = tab.future[0]
      updateActive((t) => ({
        path: next,
        history: t.path ? [...t.history, t.path].slice(-100) : t.history,
        future: t.future.slice(1),
        entries: [],
        loading: true,
        error: null
      }))
    },

    goUp: () => {
      const state = get()
      const tab = state.tabs.find((t) => t.id === state.activeTabId)
      if (!tab?.path) return
      const parent = dirName(tab.path)
      if (parent && parent !== tab.path) get().navigate(parent)
    },

    refresh: () => updateActive((tab) => ({ refreshToken: tab.refreshToken + 1 })),
    setEntries: (entries) => updateActive(() => ({ entries })),
    setLoading: (loading) => updateActive(() => ({ loading })),
    setError: (error) => updateActive(() => ({ error })),

    setSort: (key) =>
      updateActive((tab) => {
        if (tab.sort.key === key) {
          return { sort: { key, direction: tab.sort.direction === 'asc' ? 'desc' : 'asc' } }
        }
        return { sort: { key, direction: key === 'modifiedAt' || key === 'size' ? 'desc' : 'asc' } }
      }),

    setKindFilter: (kindFilter) => updateActive(() => ({ kindFilter }))
  }
})

/** Selector for the active tab (never null — at least one always exists). */
export const useActiveTab = (): BrowserTab =>
  useBrowserStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? s.tabs[0])

export interface HomeFoldersState {
  homeFolders: FolderInfo[]
  homePath: string
  appInfo: AppInfo | null
  /** Hardware summary for the sidebar card. */
  systemInfo: SystemInfo | null
  volumes: FolderInfo[]
  /** Calculated recursive folder sizes, keyed by folder path. */
  folderSizes: Map<string, { bytes: number; files: number; truncated: boolean }>
  setHomeFolders: (folders: FolderInfo[]) => void
  setHomePath: (homePath: string) => void
  setAppInfo: (info: AppInfo) => void
  setSystemInfo: (info: SystemInfo) => void
  setVolumes: (volumes: FolderInfo[]) => void
  setFolderSize: (path: string, size: { bytes: number; files: number; truncated: boolean }) => void
}

export const useMetaStore = create<HomeFoldersState>((set) => ({
  homeFolders: [],
  homePath: '/',
  appInfo: null,
  systemInfo: null,
  volumes: [],
  folderSizes: new Map(),
  setHomeFolders: (homeFolders) => set({ homeFolders }),
  setHomePath: (homePath) => set({ homePath }),
  setAppInfo: (appInfo) => set({ appInfo }),
  setSystemInfo: (systemInfo) => set({ systemInfo }),
  setVolumes: (volumes) => set({ volumes }),
  setFolderSize: (path, size) =>
    set((state) => {
      const folderSizes = new Map(state.folderSizes)
      folderSizes.set(path, size)
      return { folderSizes }
    })
}))
