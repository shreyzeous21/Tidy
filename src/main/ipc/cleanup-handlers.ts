import { ipcMain, BrowserWindow } from 'electron'
import type { DuplicateScanOptions, LargeFilesScanOptions, ScanProgress } from '@shared/types/cleanup'
import { AppError, guard } from '../utils/errors'
import { normalizePath } from '../utils/path-validation'
import { scanDuplicates, scanEmptyFolders, scanLargeFiles, scanOldFiles } from '../services/cleanup'
import { getStorageOverview } from '../services/storage-overview'
import { scanDevArtifacts } from '../services/dev-artifacts'
import { computeFolderSize } from '../services/folder-size'
import {
  analyzeCacheRoot,
  findBrokenLinks,
  findDuplicateFolders,
  findEmptyFiles,
  findOldInstallers,
  findTempFiles
} from '../services/finders'
import { findSimilarImages } from '../services/similar-images'
import { repoStatus, scanRepositories } from '../services/git'
import { compareFolders } from '../services/compare-folders'
import { getUsageHistory, recordUsageSnapshot } from '../services/usage-history'
import { hashFile } from '../services/fs-core'
import os from 'node:os'
import type { HandlerContext } from './context'

/**
 * Clean Up IPC handlers. Scans run asynchronously; progress is streamed to
 * the window on the 'cleanup:progress' channel. Because the renderer cannot
 * know a scan's id until it finishes, `cleanup:cancel` cancels every
 * in-flight scan (there is only ever one window driving scans).
 */

const activeScanIds = new Set<string>()

function progressSender(scanId: string): (p: Omit<ScanProgress, 'scanId'>) => void {
  return (p): void => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('cleanup:progress', {
      ...p,
      scanId
    } satisfies ScanProgress)
  }
}

function newScanId(): string {
  return `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function registerCleanupHandlers(ctx: HandlerContext): void {
  ipcMain.handle('cleanup:large', (_event, options: unknown) =>
    guard(async () => {
      if (!options || typeof options !== 'object') {
        throw new AppError('INVALID_INPUT', 'Invalid scan options.')
      }
      const opts = options as LargeFilesScanOptions
      const root = normalizePath(opts.root, 'scan folder')
      const thresholdMB =
        typeof opts.thresholdMB === 'number' && opts.thresholdMB > 0 ? opts.thresholdMB : 100
      const scanId = newScanId()
      activeScanIds.add(scanId)
      try {
        const result = await scanLargeFiles(root, thresholdMB, scanId, ctx.cancels, progressSender(scanId))
        return { scanId, result }
      } finally {
        activeScanIds.delete(scanId)
        ctx.cancels.forget(scanId)
      }
    })
  )

  ipcMain.handle('cleanup:duplicates', (_event, options: unknown) =>
    guard(async () => {
      if (!options || typeof options !== 'object' || !Array.isArray((options as DuplicateScanOptions).roots)) {
        throw new AppError('INVALID_INPUT', 'Invalid scan options.')
      }
      const opts = options as DuplicateScanOptions
      const roots = opts.roots.slice(0, 5).map((r) => normalizePath(r, 'scan folder'))
      const minSizeBytes =
        typeof opts.minSizeBytes === 'number' && opts.minSizeBytes >= 0 ? opts.minSizeBytes : 1024 * 1024
      const scanId = newScanId()
      activeScanIds.add(scanId)
      try {
        const result = await scanDuplicates(roots, minSizeBytes, scanId, ctx.cancels, progressSender(scanId))
        return { scanId, result }
      } finally {
        activeScanIds.delete(scanId)
        ctx.cancels.forget(scanId)
      }
    })
  )

  ipcMain.handle('cleanup:old', (_event, options: unknown) =>
    guard(async () => {
      if (!options || typeof options !== 'object') {
        throw new AppError('INVALID_INPUT', 'Invalid scan options.')
      }
      const opts = options as { root?: unknown; olderThanDays?: unknown }
      const root = normalizePath(opts.root, 'scan folder')
      const olderThanDays =
        typeof opts.olderThanDays === 'number' && opts.olderThanDays > 0 ? Math.min(opts.olderThanDays, 3650) : 90
      const scanId = newScanId()
      activeScanIds.add(scanId)
      try {
        const result = await scanOldFiles(root, olderThanDays, scanId, ctx.cancels, progressSender(scanId))
        return { scanId, result }
      } finally {
        activeScanIds.delete(scanId)
        ctx.cancels.forget(scanId)
      }
    })
  )

  ipcMain.handle('cleanup:empty-folders', (_event, options: unknown) =>
    guard(async () => {
      if (!options || typeof options !== 'object') {
        throw new AppError('INVALID_INPUT', 'Invalid scan options.')
      }
      const root = normalizePath((options as { root?: unknown }).root, 'scan folder')
      const scanId = newScanId()
      activeScanIds.add(scanId)
      try {
        const result = await scanEmptyFolders(root, scanId, ctx.cancels, progressSender(scanId))
        return { scanId, result }
      } finally {
        activeScanIds.delete(scanId)
        ctx.cancels.forget(scanId)
      }
    })
  )

  ipcMain.handle('storage:overview', (_event, inputRoot: unknown) =>
    guard(async () => {
      const root = normalizePath(inputRoot ?? '~', 'storage root')
      const scanId = newScanId()
      activeScanIds.add(scanId)
      try {
        const result = await getStorageOverview(root, () => ctx.cancels.isCancelled(scanId), (processed, currentPath) => {
          BrowserWindow.getAllWindows()[0]?.webContents.send('cleanup:progress', {
            scanId,
            phase: 'listing',
            processed,
            currentPath
          })
        })
        return result
      } finally {
        activeScanIds.delete(scanId)
        ctx.cancels.forget(scanId)
      }
    })
  )

  ipcMain.handle('cleanup:dev-artifacts', (_event, inputRoot: unknown) =>
    guard(async () => {
      const root = normalizePath(inputRoot ?? '~', 'scan folder')
      const scanId = newScanId()
      activeScanIds.add(scanId)
      try {
        const result = await scanDevArtifacts(
          root,
          () => ctx.cancels.isCancelled(scanId),
          (visited, currentPath) => {
            BrowserWindow.getAllWindows()[0]?.webContents.send('cleanup:progress', {
              scanId,
              phase: 'listing',
              processed: visited,
              currentPath
            })
          },
          (dir) => computeFolderSize(dir)
        )
        return { scanId, result }
      } finally {
        activeScanIds.delete(scanId)
        ctx.cancels.forget(scanId)
      }
    })
  )

  const finderHandler = (
    channel: string,
    run: (root: string, ctx: { isCancelled: () => boolean; scanId: string; onProgress: (p: Omit<ScanProgress, 'scanId'>) => void }) => Promise<unknown>
  ): void => {
    ipcMain.handle(channel, (_event, inputRoot: unknown) =>
      guard(async () => {
        const root = normalizePath(inputRoot ?? os.homedir(), 'scan folder')
        const scanId = newScanId()
        activeScanIds.add(scanId)
        try {
          const result = await run(root, {
            isCancelled: () => ctx.cancels.isCancelled(scanId),
            scanId,
            onProgress: (p) => {
              BrowserWindow.getAllWindows()[0]?.webContents.send('cleanup:progress', { ...p, scanId } satisfies ScanProgress)
            }
          })
          return { scanId, result }
        } finally {
          activeScanIds.delete(scanId)
          ctx.cancels.forget(scanId)
        }
      })
    )
  }

  finderHandler('cleanup:empty-files', (root, c) =>
    findEmptyFiles(root, { isCancelled: c.isCancelled, scanId: c.scanId, onProgress: (processed, currentPath) => c.onProgress({ phase: 'listing', processed, currentPath }) })
  )
  finderHandler('cleanup:broken-links', (root, c) =>
    findBrokenLinks(root, { isCancelled: c.isCancelled, scanId: c.scanId, onProgress: (processed, currentPath) => c.onProgress({ phase: 'listing', processed, currentPath }) })
  )
  finderHandler('cleanup:temp-files', (root, c) =>
    findTempFiles(root, { isCancelled: c.isCancelled, scanId: c.scanId, onProgress: (processed, currentPath) => c.onProgress({ phase: 'listing', processed, currentPath }) })
  )
  finderHandler('cleanup:old-installers', (root, c) =>
    findOldInstallers(root, 30, { isCancelled: c.isCancelled, scanId: c.scanId, onProgress: (processed, currentPath) => c.onProgress({ phase: 'listing', processed, currentPath }) })
  )
  finderHandler('cleanup:cache', (root, c) =>
    analyzeCacheRoot(root, { isCancelled: c.isCancelled, scanId: c.scanId, onProgress: (processed, currentPath) => c.onProgress({ phase: 'listing', processed, currentPath }) })
  )
  finderHandler('cleanup:duplicate-folders', (root, c) =>
    findDuplicateFolders(root, { isCancelled: c.isCancelled, scanId: c.scanId, onProgress: (processed, currentPath) => c.onProgress({ phase: 'listing', processed, currentPath }) }, (file) => hashFile(file, { headBytes: 64 * 1024 }))
  )
  finderHandler('cleanup:similar-images', (root, c) =>
    findSimilarImages(root, c.isCancelled, (processed, currentPath) => c.onProgress({ phase: 'listing', processed, currentPath }))
  )
  finderHandler('cleanup:git-repos', (root, c) =>
    scanRepositories(root, c.isCancelled, (visited, currentPath) => c.onProgress({ phase: 'listing', processed: visited, currentPath }), true)
  )
  ipcMain.handle('tools:compare-folders', (_event, dirA: unknown, dirB: unknown) =>
    guard(async () => {
      const a = normalizePath(dirA, 'folder A')
      const b = normalizePath(dirB, 'folder B')
      const scanId = newScanId()
      activeScanIds.add(scanId)
      try {
        return await compareFolders(a, b, () => ctx.cancels.isCancelled(scanId))
      } finally {
        activeScanIds.delete(scanId)
        ctx.cancels.forget(scanId)
      }
    })
  )

  ipcMain.handle('git:status', (_event, inputRepo: unknown) =>
    guard(async () => repoStatus(normalizePath(inputRepo, 'repository path')))
  )

  ipcMain.handle('usage:history', () => guard(async () => getUsageHistory()))
  ipcMain.handle('usage:record', () =>
    guard(async () => {
      const { volumeUsageOf } = await import('../services/volumes-usage')
      const volumes = await volumeUsageOf()
      await recordUsageSnapshot(volumes)
      return volumes
    })
  )

  ipcMain.handle('cleanup:cancel', () =>
    guard(async () => {
      for (const id of activeScanIds) ctx.cancels.cancel(id)
    })
  )
}
