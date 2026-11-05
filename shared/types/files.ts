/** File-kind taxonomy shared by main and renderer. */
export type FileKind =
  | 'folder'
  | 'document'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'installer'
  | 'code'
  | 'other'

/** Categories used by the Downloads organizer. */
export type DownloadCategory =
  | 'documents'
  | 'images'
  | 'videos'
  | 'audio'
  | 'archives'
  | 'installers'
  | 'other'

/** A single file-system entry as seen by the renderer. */
export interface FileEntry {
  /** File or folder name (not the full path). */
  name: string
  /** Absolute, normalized path. */
  path: string
  isDirectory: boolean
  isSymlink: boolean
  /** Bytes. Directories report 0. */
  size: number
  /** Epoch milliseconds of last modification. */
  modifiedAt: number
  kind: FileKind
  /** Lowercased extension without the dot, e.g. "pdf". Empty for folders. */
  extension: string
}

export interface DirectoryListing {
  path: string
  entries: FileEntry[]
}

export type SortKey = 'name' | 'kind' | 'size' | 'modifiedAt'
export type SortDirection = 'asc' | 'desc'

/** Well-known user folders surfaced on Home / Quick Move. */
export interface FolderInfo {
  name: string
  path: string
  /** Stable identifier, e.g. "downloads". */
  id: string
}

/** Structured application error passed across IPC. */
export interface AppErrorShape {
  code:
    | 'PERMISSION_DENIED'
    | 'NOT_FOUND'
    | 'CONFLICT'
    | 'ALREADY_EXISTS'
    | 'INVALID_INPUT'
    | 'UNSUPPORTED'
    | 'DISK_FULL'
    | 'CANCELLED'
    | 'MD_FIND_UNAVAILABLE'
    | 'UNKNOWN'
  message: string
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorShape }

/** How to resolve a destination name collision for a move/rename. */
export type ConflictPolicy = 'skip' | 'replace' | 'keep-both'

/** A pending destination collision detected before a move starts. */
export interface MoveConflict {
  sourcePath: string
  sourceName: string
  targetPath: string
  /** True when the colliding destination is a folder (replace is not offered). */
  targetIsDirectory: boolean
}

export type MoveStatus = 'moved' | 'replaced' | 'renamed' | 'skipped' | 'failed'

/** Per-item outcome of a batch move. */
export interface MoveItemResult {
  sourcePath: string
  status: MoveStatus
  /** Final path after the move (may differ when auto-renamed). */
  finalPath?: string
  error?: AppErrorShape
}

/** Per-item outcome of a batch trash operation. */
export interface TrashItemResult {
  path: string
  status: 'trashed' | 'failed'
  error?: AppErrorShape
}

/** Per-item outcome of a permanent (irreversible) delete. */
export interface DeleteItemResult {
  path: string
  status: 'deleted' | 'failed'
  error?: AppErrorShape
}

/** Contents of the macOS Trash. */
export interface TrashListing {
  path: string
  /** False when ~/.Trash doesn't exist yet — nothing has been trashed. */
  exists: boolean
  /**
   * True when macOS privacy permissions blocked reading ~/.Trash. Trash
   * access needs Full Disk Access on modern macOS, so this is a normal state,
   * not an error.
   */
  permissionDenied?: boolean
  entries: FileEntry[]
}

export interface RenameResult {
  finalPath: string
}
