import type { FileEntry } from './files'

export interface LargeFilesScanOptions {
  root: string
  thresholdMB: number
}

export interface DuplicateScanOptions {
  roots: string[]
  /** Only files at least this large are considered (bytes). */
  minSizeBytes: number
}

export interface DuplicateGroup {
  /** Full content hash shared by every file in the group. */
  hash: string
  size: number
  files: FileEntry[]
}

export interface ScanProgress {
  scanId: string
  phase: 'listing' | 'hashing-partial' | 'hashing-full' | 'done'
  /** Processed so far in the current phase. */
  processed: number
  /** Total items in the current phase, when known. */
  total?: number
  currentPath?: string
}

export interface CleanupResponse<T> {
  scanId: string
  result: T
}

export interface AppInfo {
  versions: { app: string; electron: string; chrome: string; node: string }
  platform: string
  homePath: string
  mdfindAvailable: boolean
}

/** A found development artifact (node_modules, DerivedData, dist, …). */
export interface DevArtifact {
  path: string
  name: string
  bytes: number
  truncated: boolean
}

/** A read of a file's text content for the in-app viewer. */
export interface ReadTextResult {
  /** True when the file looks binary (contains NUL bytes) — no content shown. */
  binary: boolean
  content: string
  /** Bytes of the original file. */
  size: number
  /** True when content was capped at the read limit. */
  truncated: boolean
}

/** A broken symlink: target recorded for context. */
export interface BrokenLink {
  path: string
  target: string
}

/** Groups of folders with byte-identical contents. */
export interface DuplicateFolderGroup {
  paths: string[]
  fileCount: number
  bytes: number
}

/** Images grouped by perceptual (dHash) similarity. */
export interface SimilarImageGroup {
  hash: string
  images: Array<{ path: string; name: string; size: number }>
}

export interface RepoInfo {
  path: string
  name: string
  branch: string
  /** Changed (tracked) entries from git status --porcelain. */
  modified: number
  untracked: number
  lastCommit: string
  /** Size of the .git directory. */
  gitBytes: number
  truncated: boolean
}

export interface FolderCompareResult {
  onlyInA: string[]
  onlyInB: string[]
  /** Relative paths present in both with different sizes. */
  differing: string[]
  identicalCount: number
  truncated: boolean
}

export interface UsageSnapshot {
  /** ISO date (day granularity). */
  at: string
  volumes: Array<{ path: string; used: number; total: number }>
}

export interface TimelineEvent {
  at: string
  event: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
  name: string
}

export interface CacheItem {
  path: string
  name: string
  bytes: number
  truncated: boolean
}
