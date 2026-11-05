import type { FileKind } from './files'

/** Rich metadata for a single item, shown in the Get Info panel. */
export interface ItemInfo {
  path: string
  name: string
  kind: FileKind
  isDirectory: boolean
  isSymlink: boolean
  /** Target of a symlink, when applicable. */
  symlinkTarget?: string
  size: number
  createdAt: number
  modifiedAt: number
  accessedAt: number
  /** Octal permission bits, e.g. "644". */
  permissionsOctal: string
  /** rwx-style string, e.g. "rw-r--r--". */
  permissionsRwx: string
  ownerUid: number
  /** True when the file is owned by the user running Tidy. */
  ownerIsYou: boolean
  /** Dotfile / hidden by naming convention. */
  hidden: boolean
}

export interface VolumeUsage {
  path: string
  name: string
  /** Total bytes of the volume. */
  total: number
  /** Free bytes. */
  free: number
  used: number
}

export interface FolderSizeRow {
  path: string
  bytes: number
}

/** An installed application (/Applications or ~/Applications). */
export interface ApplicationEntry {
  name: string
  path: string
  /** Source folder: system-wide or user-installed. */
  source: 'system' | 'user'
  /** Null until "Calculate sizes" runs. */
  sizeBytes: number | null
}

export interface StorageOverview {
  volumes: VolumeUsage[]
  /** Largest folders directly under the scanned root (bounded walk). */
  largestFolders: FolderSizeRow[]
  /** Bytes per Downloads-category across the scanned tree. */
  categories: Array<{ category: string; bytes: number }>
  truncated: boolean
}
