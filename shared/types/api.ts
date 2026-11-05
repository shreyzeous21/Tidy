import type {
  ApiResult,
  DirectoryListing,
  FileEntry,
  FolderInfo,
  MoveConflict,
  MoveItemResult,
  ConflictPolicy,
  RenameResult,
  TrashItemResult,
  DeleteItemResult,
  TrashListing
} from './files'
import type { SearchOptions, SearchResponse } from './search'
import type { AppSettings, OperationHistoryItem } from './settings'
import type { ItemInfo, StorageOverview, ApplicationEntry, VolumeUsage, LaunchAgentInfo, SystemInfo } from './info'
import type { PermissionId, PermissionStatus } from './permissions'
import type { FolderCompareResult } from './cleanup'
import type {
  AppInfo,
  DuplicateGroup,
  DuplicateScanOptions,
  LargeFilesScanOptions,
  ScanProgress,
  CleanupResponse,
  DevArtifact,
  ReadTextResult,
  BrokenLink,
  CacheItem,
  DuplicateFolderGroup,
  SimilarImageGroup,
  RepoInfo,
  TimelineEvent,
  UsageSnapshot
} from './cleanup'

export interface HomeFolderInfo {
  folders: FolderInfo[]
  /** Folders that could not be read (typically macOS TCC permission gaps). */
  unreadable: Array<{ path: string; code: string }>
}

/**
 * The complete typed API exposed to the renderer through contextBridge.
 * Every method crosses a validated IPC boundary; see src/main/ipc.
 */
export interface FileManagerAPI {
  // Browsing
  listDirectory(path: string): Promise<ApiResult<DirectoryListing>>
  getHomeFolders(): Promise<ApiResult<HomeFolderInfo>>
  pickFolder(title?: string): Promise<ApiResult<string | null>>

  // Item actions
  openPath(path: string): Promise<ApiResult<void>>
  revealInFinder(path: string): Promise<ApiResult<void>>
  renameItem(path: string, newName: string, overwrite: boolean): Promise<ApiResult<RenameResult>>
  checkMoveConflicts(
    paths: string[],
    destination: string
  ): Promise<ApiResult<MoveConflict[]>>
  moveItems(
    paths: string[],
    destination: string,
    policy: ConflictPolicy
  ): Promise<ApiResult<MoveItemResult[]>>
  moveToTrash(paths: string[]): Promise<ApiResult<TrashItemResult[]>>
  /** Contents of the macOS Trash (~/.Trash). */
  listTrash(): Promise<ApiResult<TrashListing>>
  /** Permanently delete items that already live in the Trash. Irreversible. */
  deletePermanently(paths: string[]): Promise<ApiResult<DeleteItemResult[]>>
  /** Create "untitled folder" (auto-numbered) in the given directory. */
  createFolder(parentDir: string): Promise<ApiResult<FileEntry>>
  /** Copy an item in place as "name copy.ext" (files and folders). */
  duplicateItem(path: string): Promise<ApiResult<FileEntry>>
  /** Open the item's folder (or the folder itself) in Terminal.app. */
  openInTerminal(path: string): Promise<ApiResult<void>>
  /** Native macOS Quick Look panel for a file. */
  previewFile(path: string): Promise<ApiResult<void>>
  /** Copy items into a destination (same conflict policies as move). */
  copyItems(
    paths: string[],
    destination: string,
    policy: ConflictPolicy
  ): Promise<ApiResult<MoveItemResult[]>>
  /** Rich metadata for a single item (permissions, dates, ownership). */
  getItemInfo(path: string): Promise<ApiResult<ItemInfo>>
  /** Recursively compute a folder's size (bounded walk). */
  getFolderSize(
    path: string
  ): Promise<ApiResult<{ bytes: number; files: number; truncated: boolean }>>
  /** Zip selected items into "name.zip" beside the first item. */
  compressItems(paths: string[]): Promise<ApiResult<FileEntry>>
  /** Extract a .zip archive into an auto-named folder beside it. */
  extractArchive(path: string): Promise<ApiResult<FileEntry>>
  /** Mounted external volumes (from /Volumes). */
  listVolumes(): Promise<ApiResult<FolderInfo[]>>
  /** Volume usage + largest folders + category breakdown (bounded scan). */
  getStorageOverview(root: string): Promise<ApiResult<StorageOverview>>
  /** Regeneratable dev artifacts (node_modules, DerivedData, …) under a root. */
  scanDevArtifacts(root: string): Promise<ApiResult<CleanupResponse<DevArtifact[]>>>
  /** Installed applications from /Applications and ~/Applications. */
  listApplications(): Promise<ApiResult<ApplicationEntry[]>>
  /** Unmatched Application Support folders (leftovers, review-only). */
  getAppLeftovers(): Promise<ApiResult<FileEntry[]>>
  /** Login item names (read-only; may require Automation permission). */
  listLoginItems(): Promise<ApiResult<string[]>>
  /** Launch agents (user + local domains). */
  listLaunchAgents(): Promise<ApiResult<LaunchAgentInfo[]>>
  /** Read a file as text for the in-app viewer (binary files are flagged). */
  readTextFile(path: string): Promise<ApiResult<ReadTextResult>>
  /** Streamed checksum (sha256 or md5). */
  checksum(path: string, algorithm: 'sha256' | 'md5'): Promise<ApiResult<{ algorithm: string; hex: string; bytes: number }>>
  /** Export a bounded directory tree to a chosen file. */
  exportTree(path: string, format: 'text' | 'json'): Promise<ApiResult<string | null>>
  /** Raw change timeline for the currently watched folder. */
  getTimeline(): Promise<ApiResult<TimelineEvent[]>>
  /** Storage usage snapshots + a fresh one recorded on demand. */
  getUsageHistory(): Promise<ApiResult<UsageSnapshot[]>>
  recordUsageSnapshot(): Promise<ApiResult<VolumeUsage[]>>
  /** Light statfs-only volume usage for live monitoring. */
  volumesUsage(): Promise<ApiResult<VolumeUsage[]>>

  // Live updates
  /**
   * Subscribe to external-volume mount/unmount notifications.
   * Returns an unsubscribe function.
   */
  onVolumesChanged(callback: () => void): () => void

  // Downloads
  scanDownloads(): Promise<ApiResult<DirectoryListing>>

  // Search
  searchFiles(options: SearchOptions): Promise<ApiResult<SearchResponse>>

  // Clean up
  scanLargeFiles(
    options: LargeFilesScanOptions
  ): Promise<ApiResult<CleanupResponse<FileEntry[]>>>
  scanDuplicates(
    options: DuplicateScanOptions
  ): Promise<ApiResult<CleanupResponse<DuplicateGroup[]>>>
  /** Files not modified within the given number of days, oldest first. */
  scanOldFiles(options: {
    root: string
    olderThanDays: number
  }): Promise<ApiResult<CleanupResponse<FileEntry[]>>>
  /** Zero-byte files. */
  scanEmptyFiles(root: string): Promise<ApiResult<CleanupResponse<FileEntry[]>>>
  /** Symlinks pointing at missing targets. */
  scanBrokenLinks(root: string): Promise<ApiResult<CleanupResponse<BrokenLink[]>>>
  /** Leftover temp/backup files by name pattern. */
  scanTempFiles(root: string): Promise<ApiResult<CleanupResponse<FileEntry[]>>>
  /** Disk images untouched for 30+ days. */
  scanOldInstallers(root: string): Promise<ApiResult<CleanupResponse<FileEntry[]>>>
  /** Top-level children of a cache root with sizes. */
  scanCache(root: string): Promise<ApiResult<CleanupResponse<CacheItem[]>>>
  /** Byte-identical folder trees. */
  scanDuplicateFolders(root: string): Promise<ApiResult<CleanupResponse<DuplicateFolderGroup[]>>>
  /** Perceptually similar images (dHash). */
  scanSimilarImages(root: string): Promise<ApiResult<CleanupResponse<SimilarImageGroup[]>>>
  /** Git repositories with status + sizes. */
  scanGitRepos(root: string): Promise<ApiResult<CleanupResponse<RepoInfo[]>>>
  /** Porcelain status lines for one repository. */
  gitStatus(repo: string): Promise<ApiResult<string[]>>
  /** Compare two folders (path sets + head-hash verified equality). */
  compareFolders(dirA: string, dirB: string): Promise<ApiResult<FolderCompareResult>>
  /** Outermost folders whose entire subtree contains no files. */
  scanEmptyFolders(options: { root: string }): Promise<ApiResult<CleanupResponse<string[]>>>
  cancelScan(scanId: string): Promise<ApiResult<void>>

  // Settings & history
  getSettings(): Promise<ApiResult<AppSettings>>
  updateSettings(patch: Partial<AppSettings>): Promise<ApiResult<AppSettings>>
  clearHistory(): Promise<ApiResult<void>>
  /** Undo a rename/move recorded in the history. */
  undoOperation(id: string): Promise<ApiResult<void>>
  resetSettings(): Promise<ApiResult<AppSettings>>
  getHistory(): Promise<ApiResult<OperationHistoryItem[]>>
  getAppInfo(): Promise<ApiResult<AppInfo>>
  /** Hardware summary for the sidebar card (model, chip, cores, memory, OS). */
  getSystemInfo(): Promise<ApiResult<SystemInfo>>

  // Permissions (first-run onboarding)
  /** Current macOS permission states, for the setup flow. */
  getPermissionStatuses(): Promise<ApiResult<PermissionStatus[]>>
  /** Re-check a single permission without prompting. */
  checkPermission(id: PermissionId): Promise<ApiResult<PermissionStatus>>
  /** Trigger the OS prompt where possible, then return the resulting state. */
  requestPermission(id: PermissionId): Promise<ApiResult<PermissionStatus>>
  /** Open the matching System Settings pane (for settings-only permissions). */
  openPermissionSettings(id: PermissionId): Promise<ApiResult<void>>

  // Live updates
  /**
   * Subscribe to debounced change notifications for a watched folder.
   * Pass `null` to stop watching. Returns an unsubscribe function.
   */
  watchDirectory(path: string | null, onEvent: () => void): () => void
  /**
   * Register (or replace) the single listener for Clean Up scan progress.
   * Pass `null` to unregister.
   */
  onScanProgress(callback: ((progress: ScanProgress) => void) | null): void
}
