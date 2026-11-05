import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Stats } from 'node:fs'
import { app, dialog, shell, BrowserWindow } from 'electron'
import type { FolderInfo, FileEntry, TrashListing } from '@shared/types/files'
import type { ItemInfo, ApplicationEntry } from '@shared/types/info'
import { kindForFile } from '@shared/constants/categories'
import { AppError, toAppErrorShape } from '../utils/errors'
import { listDirectory } from './fs-core'

/**
 * Electron-facing filesystem service: native dialogs, Finder integration,
 * Trash. Core listing/renaming/moving lives in fs-core.ts (Electron-free).
 */

const HOME_FOLDER_IDS = ['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos'] as const

/** Well-known user folders, with per-folder readability probed honestly. */
export async function getHomeFolders(): Promise<{
  folders: FolderInfo[]
  unreadable: Array<{ path: string; code: string }>
}> {
  const folders: FolderInfo[] = []
  const unreadable: Array<{ path: string; code: string }> = []

  for (const id of HOME_FOLDER_IDS) {
    let dir: string
    try {
      dir = app.getPath(id)
    } catch {
      continue
    }
    const info: FolderInfo = { id, name: friendlyName(id), path: dir }
    try {
      await fsp.access(dir)
      folders.push(info)
    } catch (error) {
      unreadable.push({ path: dir, code: toAppErrorShape(error).code })
    }
  }
  return { folders, unreadable }
}

function friendlyName(id: string): string {
  switch (id) {
    case 'desktop':
      return 'Desktop'
    case 'documents':
      return 'Documents'
    case 'downloads':
      return 'Downloads'
    case 'pictures':
      return 'Pictures'
    case 'music':
      return 'Music'
    case 'videos':
      return 'Movies'
    default:
      return id
  }
}

export async function scanDownloads(): Promise<{ path: string; entries: FileEntry[] }> {
  const downloads = app.getPath('downloads')
  const entries = await listDirectory(downloads)
  return { path: downloads, entries }
}

/** Open a file with its default application. Returns an error shape on failure. */
export async function openPath(p: string): Promise<void> {
  const result = await shell.openPath(p)
  if (result) {
    // shell.openPath returns a non-empty string as the error message.
    throw new AppError('UNKNOWN', result)
  }
}

export function revealInFinder(p: string): void {
  shell.showItemInFolder(p)
}

/**
 * Open Terminal.app at the given folder (or a file's containing folder).
 * Uses the fixed system `open` binary with argv-array arguments only.
 */
export async function openInTerminal(target: string): Promise<void> {
  const { execFile } = await import('node:child_process')
  await new Promise<void>((resolve, reject) => {
    execFile('open', ['-a', 'Terminal', target], { shell: false }, (error) => {
      if (error) reject(new AppError('UNKNOWN', 'Could not launch Terminal.'))
      else resolve()
    })
  })
}

/** Native folder picker. Any picked folder becomes an approved root (caller persists it). */
export async function pickFolder(title: string): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title,
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: os.homedir()
  }
  const win = BrowserWindow.getFocusedWindow()
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

/** Move items to the macOS Trash, sequentially, with per-item outcomes. */
export async function moveToTrash(
  paths: string[]
): Promise<Array<{ path: string; status: 'trashed' | 'failed'; error?: unknown }>> {
  const results: Array<{ path: string; status: 'trashed' | 'failed'; error?: unknown }> = []
  for (const p of paths) {
    try {
      // Verify the item still exists so error messages are precise.
      await fsp.lstat(p)
      // shell.trashItem resolves on success and rejects on failure.
      await shell.trashItem(p)
      results.push({ path: p, status: 'trashed' })
    } catch (error) {
      results.push({ path: p, status: 'failed', error })
    }
  }
  return results
}

export function homePath(): string {
  return os.homedir()
}

/** Absolute path to the user's Trash. */
export function trashDirectory(): string {
  return path.join(os.homedir(), '.Trash')
}

/**
 * Contents of ~/.Trash. Finder keeps its "Put Back" metadata in .DS_Store,
 * which is hidden from the listing. A missing Trash folder is an empty Trash,
 * not an error.
 *
 * macOS protects ~/.Trash behind Full Disk Access, so a permission failure is
 * reported as an empty, flagged listing rather than thrown — the renderer
 * shows guidance instead of a raw error.
 */
export async function listTrash(): Promise<TrashListing> {
  const dir = trashDirectory()
  try {
    const entries = await listDirectory(dir)
    return {
      path: dir,
      exists: true,
      entries: entries.filter((entry) => entry.name !== '.DS_Store')
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { path: dir, exists: false, entries: [] }
    }
    if (code === 'EPERM' || code === 'EACCES') {
      return { path: dir, exists: true, permissionDenied: true, entries: [] }
    }
    throw error
  }
}

/** Rich metadata for the Get Info panel. Never follows symlinks for identity. */
export async function getItemInfo(itemPath: string): Promise<ItemInfo> {
  const lstat = await fsp.lstat(itemPath)
  const name = path.basename(itemPath)
  const isSymlink = lstat.isSymbolicLink()
  let symlinkTarget: string | undefined
  let targetStat: Stats | null = null
  if (isSymlink) {
    try {
      symlinkTarget = await fsp.readlink(itemPath)
      targetStat = await fsp.stat(itemPath)
    } catch {
      symlinkTarget = symlinkTarget ?? '→ broken link'
    }
  }
  const mode = lstat.mode
  const bitsToString = (bits: number): string =>
    `${bits & 4 ? 'r' : '-'}${bits & 2 ? 'w' : '-'}${bits & 1 ? 'x' : '-'}`
  const permString =
    bitsToString((mode >> 6) & 7) + bitsToString((mode >> 3) & 7) + bitsToString(mode & 7)

  return {
    path: itemPath,
    name,
    kind: kindForFile(name, lstat.isDirectory()),
    isDirectory: lstat.isDirectory(),
    isSymlink,
    symlinkTarget,
    size: lstat.isFile() ? lstat.size : targetStat?.isFile() ? targetStat.size : 0,
    createdAt: Math.floor(lstat.birthtimeMs),
    modifiedAt: Math.floor(lstat.mtimeMs),
    accessedAt: Math.floor(lstat.atimeMs),
    permissionsOctal: ((mode & 0o777) | 0).toString(8),
    permissionsRwx: permString,
    ownerUid: lstat.uid,
    ownerIsYou: lstat.uid === process.getuid?.(),
    hidden: name.startsWith('.')
  }
}

/** Mounted volumes from /Volumes (excluding the boot volume's aliases). */
export async function listVolumes(): Promise<FolderInfo[]> {
  try {
    const entries = await fsp.readdir('/Volumes', { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => entry.name !== 'Macintosh HD') // boot volume is Home/root browsing
      .map((entry) => ({ id: `volume:${entry.name}`, name: entry.name, path: path.join('/Volumes', entry.name) }))
  } catch {
    return []
  }
}

/** Installed .app bundles from /Applications and ~/Applications. */
export async function listApplications(): Promise<ApplicationEntry[]> {
  const apps: ApplicationEntry[] = []
  const sources: Array<{ dir: string; source: 'system' | 'user' }> = [
    { dir: '/Applications', source: 'system' },
    { dir: path.join(os.homedir(), 'Applications'), source: 'user' }
  ]
  for (const { dir, source } of sources) {
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.toLowerCase().endsWith('.app')) continue
      apps.push({ name: entry.name.replace(/\.app$/i, ''), path: path.join(dir, entry.name), source, sizeBytes: null })
    }
  }
  apps.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
  return apps
}

const TEXT_READ_LIMIT = 512 * 1024

/**
 * Read a file's text content for the in-app viewer. Binary files (NUL byte
 * in the leading sample) are reported honestly instead of rendered as mojibake.
 */
export async function readTextContent(
  filePath: string
): Promise<{ binary: boolean; content: string; size: number; truncated: boolean }> {
  const stat = await fsp.stat(filePath)
  if (!stat.isFile()) {
    throw new AppError('INVALID_INPUT', 'Only files can be previewed as text.')
  }
  const size = stat.size
  const sampleLength = Math.min(size, 8192)
  const sample = Buffer.alloc(sampleLength)
  const handle = await fsp.open(filePath, 'r')
  try {
    await handle.read(sample, 0, sampleLength, 0)
  } finally {
    await handle.close()
  }
  if (sample.includes(0)) {
    return { binary: true, content: '', size, truncated: false }
  }
  const readLength = Math.min(size, TEXT_READ_LIMIT)
  const buffer = Buffer.alloc(readLength)
  const fileHandle = await fsp.open(filePath, 'r')
  try {
    await fileHandle.read(buffer, 0, readLength, 0)
  } finally {
    await fileHandle.close()
  }
  return {
    binary: false,
    content: buffer.toString('utf8'),
    size,
    truncated: size > readLength
  }
}
