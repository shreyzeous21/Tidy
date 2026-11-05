import { ipcMain } from 'electron'
import path from 'node:path'
import fsp from 'node:fs/promises'
import type {
  ConflictPolicy,
  DeleteItemResult,
  MoveItemResult,
  TrashItemResult
} from '@shared/types/files'
import { AppError, guard, toAppErrorShape } from '../utils/errors'
import { normalizePath, assertWritable, isValidName } from '../utils/path-validation'
import {
  checkMoveConflicts,
  copyEntry,
  createFolderUnique,
  duplicateEntry,
  listDirectory,
  moveEntry,
  renameEntry,
  toFileEntry
} from '../services/fs-core'
import { computeFolderSize } from '../services/folder-size'
import {
  getItemInfo,
  getHomeFolders,
  listApplications,
  listTrash,
  listVolumes,
  moveToTrash,
  openInTerminal,
  openPath,
  pickFolder,
  readTextContent,
  revealInFinder,
  scanDownloads,
  trashDirectory
} from '../services/filesystem'
import { compressItems, extractArchive } from '../services/archives'
import { appendHistory } from '../services/storage'
import type { HandlerContext } from './context'

/**
 * Filesystem + Downloads IPC handlers. Every handler validates its inputs
 * before touching disk; write operations are limited to approved roots.
 */

const VALID_POLICIES: ConflictPolicy[] = ['skip', 'replace', 'keep-both']

function asStringArray(input: unknown, label: string): string[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 1000) {
    throw new AppError('INVALID_INPUT', `Invalid ${label}.`)
  }
  return input.map((p) => normalizePath(p, label))
}

function asPolicy(input: unknown): ConflictPolicy {
  if (typeof input !== 'string' || !VALID_POLICIES.includes(input as ConflictPolicy)) {
    throw new AppError('INVALID_INPUT', 'Invalid conflict policy.')
  }
  return input as ConflictPolicy
}

export function registerFileHandlers(ctx: HandlerContext): void {
  ipcMain.handle('fs:list', (_event, inputPath: unknown) =>
    guard(async () => {
      const dir = normalizePath(inputPath, 'folder path')
      const entries = await listDirectory(dir)
      return { path: dir, entries }
    })
  )

  ipcMain.handle('fs:home-folders', () => guard(() => getHomeFolders()))

  ipcMain.handle('fs:pick-folder', (_event, title: unknown) =>
    guard(async () => {
      const picked = await pickFolder(typeof title === 'string' && title ? title : 'Choose Folder')
      if (picked) {
        // A folder the user explicitly picked in the native dialog is trusted
        // as a write-approved root from now on.
        const resolved = normalizePath(picked, 'folder')
        if (!ctx.settings.approvedRoots.includes(resolved)) {
          ctx.settings.approvedRoots.push(resolved)
          await ctx.persist(ctx.settings)
        }
      }
      return picked
    })
  )

  ipcMain.handle('fs:open', (_event, inputPath: unknown) =>
    guard(async () => {
      await openPath(normalizePath(inputPath, 'item path'))
    })
  )

  ipcMain.handle('fs:reveal', (_event, inputPath: unknown) =>
    guard(async () => {
      revealInFinder(normalizePath(inputPath, 'item path'))
    })
  )

  ipcMain.handle('fs:rename', (_event, inputPath: unknown, newName: unknown, overwrite: unknown) =>
    guard(async () => {
      const itemPath = normalizePath(inputPath, 'item path')
      if (typeof newName !== 'string' || !isValidName(newName)) {
        throw new AppError('INVALID_INPUT', 'That name contains invalid characters.')
      }
      const dir = path.dirname(itemPath)
      const oldName = path.basename(itemPath)
      assertWritable(dir, ctx.settings.approvedRoots)
      const finalPath = await renameEntry(dir, oldName, newName, overwrite === true)
      await appendHistory({
        type: 'rename',
        summary: `${oldName} → ${newName}`,
        count: 1
      })
      return { finalPath }
    })
  )

  ipcMain.handle('fs:move-check', (_event, paths: unknown, destination: unknown) =>
    guard(async () => {
      const sources = asStringArray(paths, 'source paths')
      const dest = normalizePath(destination, 'destination')
      let destStat
      try {
        destStat = await fsp.stat(dest)
      } catch {
        throw new AppError('NOT_FOUND', 'The destination folder does not exist.')
      }
      if (!destStat.isDirectory()) {
        throw new AppError('INVALID_INPUT', 'The destination must be a folder.')
      }
      return checkMoveConflicts(sources, dest)
    })
  )

  ipcMain.handle('fs:move', (_event, paths: unknown, destination: unknown, policy: unknown) =>
    guard(async () => {
      const sources = asStringArray(paths, 'source paths')
      const dest = normalizePath(destination, 'destination')
      const resolvedPolicy = asPolicy(policy)

      let destStat
      try {
        destStat = await fsp.stat(dest)
      } catch {
        throw new AppError('NOT_FOUND', 'The destination folder does not exist.')
      }
      if (!destStat.isDirectory()) {
        throw new AppError('INVALID_INPUT', 'The destination must be a folder.')
      }
      // Both sides of a move must be writable: the source is removed, the
      // destination is created.
      assertWritable(dest, ctx.settings.approvedRoots)
      for (const src of sources) {
        assertWritable(path.dirname(src), ctx.settings.approvedRoots)
      }

      const results: MoveItemResult[] = []
      let movedCount = 0
      for (const src of sources) {
        try {
          const outcome = await moveEntry(src, dest, resolvedPolicy)
          results.push({
            sourcePath: src,
            status: outcome.outcome,
            finalPath: outcome.finalPath
          })
          if (outcome.outcome !== 'skipped') movedCount++
        } catch (error) {
          results.push({
            sourcePath: src,
            status: 'failed',
            error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : 'Move failed.' }
          })
        }
      }

      if (movedCount > 0) {
        const firstName = path.basename(sources[0])
        await appendHistory({
          type: 'move',
          summary:
            movedCount === 1
              ? `${firstName} → ${dest}`
              : `${movedCount} items → ${dest}`,
          count: movedCount
        })
        await bumpRecentDestination(ctx, dest)
      }
      return results
    })
  )

  ipcMain.handle('fs:trash', (_event, paths: unknown) =>
    guard(async () => {
      const sources = asStringArray(paths, 'item paths')
      for (const src of sources) {
        assertWritable(path.dirname(src), ctx.settings.approvedRoots)
      }
      const raw: TrashItemResult[] = []
      const trashResults = await moveToTrash(sources)
      let trashedCount = 0
      let firstTrashedName = ''
      for (const r of trashResults) {
        if (r.status === 'trashed') {
          trashedCount++
          if (!firstTrashedName) firstTrashedName = path.basename(r.path)
          raw.push({ path: r.path, status: 'trashed' })
        } else {
          const shape = {
            code: 'UNKNOWN' as const,
            message:
              r.error instanceof Error
                ? r.error.message
                : 'macOS could not move this item to the Trash.'
          }
          raw.push({ path: r.path, status: 'failed', error: shape })
        }
      }
      if (trashedCount > 0) {
        await appendHistory({
          type: 'trash',
          summary:
            trashedCount === 1
              ? `${firstTrashedName} → Trash`
              : `${trashedCount} items → Trash`,
          count: trashedCount
        })
      }
      return raw
    })
  )

  ipcMain.handle('trash:list', () => guard(() => listTrash()))

  ipcMain.handle('trash:delete', (_event, paths: unknown) =>
    guard(async () => {
      const items = asStringArray(paths, 'item paths')
      const trash = trashDirectory()
      // Hard safety boundary: only direct children of the Trash are deletable.
      for (const item of items) {
        if (path.dirname(item) !== trash) {
          throw new AppError(
            'PERMISSION_DENIED',
            'Only items inside the Trash can be deleted permanently.'
          )
        }
      }
      const results: DeleteItemResult[] = []
      let firstName = ''
      for (const item of items) {
        try {
          await fsp.rm(item, { recursive: true, force: true })
          results.push({ path: item, status: 'deleted' })
          if (!firstName) firstName = path.basename(item)
        } catch (error) {
          results.push({ path: item, status: 'failed', error: toAppErrorShape(error) })
        }
      }
      const deleted = results.filter((result) => result.status === 'deleted').length
      if (deleted > 0) {
        await appendHistory({
          type: 'trash',
          summary:
            deleted === 1
              ? `Permanently deleted ${firstName}`
              : `Permanently deleted ${deleted} items from Trash`,
          count: deleted
        })
      }
      return results
    })
  )

  ipcMain.handle('fs:mkdir', (_event, inputParent: unknown) =>
    guard(async () => {
      const parent = normalizePath(inputParent, 'folder path')
      assertWritable(parent, ctx.settings.approvedRoots)
      const created = await createFolderUnique(parent)
      await appendHistory({ type: 'rename', summary: `New folder ${path.basename(created)}`, count: 1 })
      return toFileEntry(created)
    })
  )

  ipcMain.handle('fs:duplicate', (_event, inputPath: unknown) =>
    guard(async () => {
      const itemPath = normalizePath(inputPath, 'item path')
      assertWritable(path.dirname(itemPath), ctx.settings.approvedRoots)
      const copyPath = await duplicateEntry(itemPath)
      await appendHistory({
        type: 'rename',
        summary: `Duplicated ${path.basename(itemPath)}`,
        count: 1
      })
      return toFileEntry(copyPath)
    })
  )

  ipcMain.handle('fs:open-terminal', (_event, inputPath: unknown) =>
    guard(async () => {
      const itemPath = normalizePath(inputPath, 'item path')
      let target = itemPath
      try {
        const stat = await fsp.stat(itemPath)
        if (!stat.isDirectory()) target = path.dirname(itemPath)
      } catch {
        target = path.dirname(itemPath)
      }
      await openInTerminal(target)
    })
  )

  ipcMain.handle('fs:preview', (event, inputPath: unknown) =>
    guard(async () => {
      const itemPath = normalizePath(inputPath, 'item path')
      // Native Quick Look belongs to the requesting window.
      const { BrowserWindow } = await import('electron')
      BrowserWindow.fromWebContents(event.sender)?.previewFile(itemPath)
    })
  )

  ipcMain.handle('fs:copy', (_event, paths: unknown, destination: unknown, policy: unknown) =>
    guard(async () => {
      const sources = asStringArray(paths, 'source paths')
      const dest = normalizePath(destination, 'destination')
      const resolvedPolicy = asPolicy(policy)
      let destStat
      try {
        destStat = await fsp.stat(dest)
      } catch {
        throw new AppError('NOT_FOUND', 'The destination folder does not exist.')
      }
      if (!destStat.isDirectory()) {
        throw new AppError('INVALID_INPUT', 'The destination must be a folder.')
      }
      // Copying needs destination write access; sources are only read.
      assertWritable(dest, ctx.settings.approvedRoots)

      const results: MoveItemResult[] = []
      for (const src of sources) {
        try {
          const outcome = await copyEntry(src, dest, resolvedPolicy)
          results.push({ sourcePath: src, status: outcome.outcome, finalPath: outcome.finalPath })
        } catch (error) {
          results.push({
            sourcePath: src,
            status: 'failed',
            error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : 'Copy failed.' }
          })
        }
      }
      const copied = results.filter((r) => r.status !== 'skipped' && r.status !== 'failed').length
      if (copied > 0) {
        await appendHistory({
          type: 'move',
          summary: copied === 1 ? `Copied ${path.basename(sources[0])} → ${dest}` : `Copied ${copied} items → ${dest}`,
          count: copied
        })
        await bumpRecentDestination(ctx, dest)
      }
      return results
    })
  )

  ipcMain.handle('fs:info', (_event, inputPath: unknown) =>
    guard(async () => getItemInfo(normalizePath(inputPath, 'item path')))
  )

  ipcMain.handle('fs:folder-size', (_event, inputPath: unknown) =>
    guard(async () => {
      const dir = normalizePath(inputPath, 'folder path')
      return computeFolderSize(dir)
    })
  )

  ipcMain.handle('fs:compress', (_event, paths: unknown) =>
    guard(async () => {
      const sources = asStringArray(paths, 'items to compress')
      for (const src of sources) assertWritable(path.dirname(src), ctx.settings.approvedRoots)
      const created = await compressItems(sources)
      await appendHistory({ type: 'rename', summary: `Compressed ${sources.length} item(s) → ${path.basename(created.path)}`, count: 1 })
      return created
    })
  )

  ipcMain.handle('fs:extract', (_event, inputPath: unknown) =>
    guard(async () => {
      const archivePath = normalizePath(inputPath, 'archive path')
      assertWritable(path.dirname(archivePath), ctx.settings.approvedRoots)
      const extracted = await extractArchive(archivePath)
      await appendHistory({ type: 'rename', summary: `Extracted ${path.basename(archivePath)}`, count: 1 })
      return extracted
    })
  )

  ipcMain.handle('volumes:list', () => guard(() => listVolumes()))

  ipcMain.handle('apps:list', () => guard(() => listApplications()))

  ipcMain.handle('fs:read-text', (_event, inputPath: unknown) =>
    guard(async () => readTextContent(normalizePath(inputPath, 'file path')))
  )

  ipcMain.handle('downloads:scan', () => guard(() => scanDownloads()))

  ipcMain.handle('watch:set', (_event, inputPath: unknown) =>
    guard(async () => {
      if (inputPath === null || inputPath === undefined) {
        ctx.watcher.watch(null)
        return
      }
      const dir = normalizePath(inputPath, 'folder path')
      try {
        const stat = await fsp.stat(dir)
        if (!stat.isDirectory()) return
      } catch {
        // Folder vanished — clear the watch quietly.
        ctx.watcher.watch(null)
        return
      }
      ctx.watcher.watch(dir)
    })
  )
}

async function bumpRecentDestination(ctx: HandlerContext, dest: string): Promise<void> {
  const list = ctx.settings.recentDestinations.filter((d) => d !== dest)
  list.unshift(dest)
  ctx.settings.recentDestinations = list.slice(0, 6)
  await ctx.persist(ctx.settings)
}
