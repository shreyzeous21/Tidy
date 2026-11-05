import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { FileManagerAPI } from '@shared/types/api'
import type { ScanProgress } from '@shared/types/cleanup'

/**
 * Tidy preload: exposes exactly one object — the typed FileManagerAPI.
 * No raw Node APIs, no raw ipcRenderer, no broad channels.
 */

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

function subscribe(
  channel: 'fs:changed' | 'cleanup:progress' | 'volumes:changed',
  callback: (payload: unknown) => void
): () => void {
  const listener = (_event: IpcRendererEvent, payload: unknown): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

// Progress is app-global (one window, one scan at a time).
let progressListener: ((p: ScanProgress) => void) | null = null
ipcRenderer.on('cleanup:progress', (_event, payload: ScanProgress) => {
  progressListener?.(payload)
})

const api: FileManagerAPI = {
  // Browsing
  listDirectory: (path) => invoke('fs:list', path),
  getHomeFolders: () => invoke('fs:home-folders'),
  pickFolder: (title) => invoke('fs:pick-folder', title),

  // Item actions
  openPath: (path) => invoke('fs:open', path),
  revealInFinder: (path) => invoke('fs:reveal', path),
  renameItem: (path, newName, overwrite) => invoke('fs:rename', path, newName, overwrite),
  checkMoveConflicts: (paths, destination) => invoke('fs:move-check', paths, destination),
  moveItems: (paths, destination, policy) => invoke('fs:move', paths, destination, policy),
  moveToTrash: (paths) => invoke('fs:trash', paths),
  listTrash: () => invoke('trash:list'),
  deletePermanently: (paths) => invoke('trash:delete', paths),
  createFolder: (parentDir) => invoke('fs:mkdir', parentDir),
  duplicateItem: (path) => invoke('fs:duplicate', path),
  openInTerminal: (path) => invoke('fs:open-terminal', path),
  previewFile: (path) => invoke('fs:preview', path),
  copyItems: (paths, destination, policy) => invoke('fs:copy', paths, destination, policy),
  getItemInfo: (path) => invoke('fs:info', path),
  getFolderSize: (path) => invoke('fs:folder-size', path),
  compressItems: (paths) => invoke('fs:compress', paths),
  extractArchive: (path) => invoke('fs:extract', path),
  listVolumes: () => invoke('volumes:list'),
  getStorageOverview: (root) => invoke('storage:overview', root),
  scanDevArtifacts: (root) => invoke('cleanup:dev-artifacts', root),
  scanEmptyFiles: (root) => invoke('cleanup:empty-files', root),
  scanBrokenLinks: (root) => invoke('cleanup:broken-links', root),
  scanTempFiles: (root) => invoke('cleanup:temp-files', root),
  scanOldInstallers: (root) => invoke('cleanup:old-installers', root),
  scanCache: (root) => invoke('cleanup:cache', root),
  scanDuplicateFolders: (root) => invoke('cleanup:duplicate-folders', root),
  scanSimilarImages: (root) => invoke('cleanup:similar-images', root),
  scanGitRepos: (root) => invoke('cleanup:git-repos', root),
  gitStatus: (repo) => invoke('git:status', repo),
  compareFolders: (a, b) => invoke('tools:compare-folders', a, b),
  getAppLeftovers: () => invoke('apps:leftovers'),
  listLoginItems: () => invoke('apps:login-items'),
  listLaunchAgents: () => invoke('apps:launch-agents'),
  checksum: (path, algorithm) => invoke('fs:checksum', path, algorithm),
  exportTree: (path, format) => invoke('fs:export-tree', path, format),
  getTimeline: () => invoke('watch:timeline'),
  getUsageHistory: () => invoke('usage:history'),
  recordUsageSnapshot: () => invoke('usage:record'),
  volumesUsage: () => invoke('volumes:usage'),
  listApplications: () => invoke('apps:list'),
  readTextFile: (path) => invoke('fs:read-text', path),

  // Downloads
  scanDownloads: () => invoke('downloads:scan'),

  // Search
  searchFiles: (options) => invoke('search:query', options),

  // Clean up
  scanLargeFiles: (options) => invoke('cleanup:large', options),
  scanDuplicates: (options) => invoke('cleanup:duplicates', options),
  scanOldFiles: (options) => invoke('cleanup:old', options),
  scanEmptyFolders: (options) => invoke('cleanup:empty-folders', options),
  cancelScan: (scanId) => invoke('cleanup:cancel', scanId),

  // Permissions (first-run onboarding)
  getPermissionStatuses: () => invoke('permissions:status'),
  checkPermission: (id) => invoke('permissions:check', id),
  requestPermission: (id) => invoke('permissions:request', id),
  openPermissionSettings: (id) => invoke('permissions:open-settings', id),

  // Settings & history
  getSettings: () => invoke('settings:get'),
  updateSettings: (patch) => invoke('settings:update', patch),
  clearHistory: () => invoke('history:clear'),
  undoOperation: (id) => invoke('history:undo', id),
  resetSettings: () => invoke('settings:reset'),
  getHistory: () => invoke('history:get'),
  getAppInfo: () => invoke('app:info'),
  getSystemInfo: () => invoke('app:system-info'),

  // Live updates
  watchDirectory: (path, onEvent) => {
    // Tell the main process which folder to watch; it keeps a single slot.
    void invoke('watch:set', path)
    const unsubscribe = subscribe('fs:changed', (payload) => {
      const data = payload as { dir: string | null } | null
      // Only deliver events for the folder the renderer actually asked to watch.
      if (path === null || data === null || data.dir === path) onEvent()
    })
    return () => {
      unsubscribe()
      void invoke('watch:set', null)
    }
  },
  onScanProgress: (callback) => {
    progressListener = callback
  },
  onVolumesChanged: (callback) => subscribe('volumes:changed', () => callback())
}

contextBridge.exposeInMainWorld('tidy', api)

export type TidyAPI = typeof api
