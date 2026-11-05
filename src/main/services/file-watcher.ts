import type { BrowserWindow } from 'electron'
import chokidar from 'chokidar'
import path from 'node:path'

/**
 * Lightweight folder watching (user-approved folders only).
 *
 * - Exactly one active "browser" watch slot: the renderer swaps it as the
 *   user navigates, so we never accumulate watchers.
 * - Events are debounced per folder before notifying the renderer.
 * - Watchers are closed on swap, on window close, and on app quit.
 */

const DEBOUNCE_MS = 400

export class FileWatcher {
  private watcher: chokidar.FSWatcher | null = null
  private watchedPath: string | null = null
  private debounceTimer: NodeJS.Timeout | null = null
  private disposed = false

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  /** Watch `dir` (replacing any previous watch) or stop watching with null. */
  watch(dir: string | null): void {
    if (this.disposed) return
    const normalized = dir ? path.resolve(dir) : null
    if (this.watchedPath === normalized) return

    this.stopWatcher()
    if (!normalized) return

    try {
      this.watcher = chokidar.watch(normalized, {
        ignoreInitial: true,
        depth: 0, // Only direct children — the renderer refetches on any change.
        awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
        persistent: true
      })
      this.watchedPath = normalized

      const notify = (): void => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer)
        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = null
          this.getWindow()?.webContents.send('fs:changed', { dir: this.watchedPath })
        }, DEBOUNCE_MS)
      }

      this.watcher.on('add', notify)
      this.watcher.on('addDir', notify)
      this.watcher.on('unlink', notify)
      this.watcher.on('unlinkDir', notify)
      this.watcher.on('change', notify)
      this.watcher.on('error', (error) => {
        console.error('[tidy] watcher error:', error)
      })
    } catch (error) {
      console.error('[tidy] failed to watch folder:', error)
      this.watchedPath = null
    }
  }

  private stopWatcher(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.watcher) {
      void this.watcher.close().catch((error) => {
        console.error('[tidy] watcher close failed:', error)
      })
      this.watcher = null
    }
    this.watchedPath = null
  }

  dispose(): void {
    this.disposed = true
    this.stopWatcher()
  }
}

/**
 * Watches /Volumes so the app can react to drives being mounted and
 * unmounted. One instance for the whole app; never restarted.
 */
export class VolumeWatcher {
  private watcher: chokidar.FSWatcher | null = null

  constructor(private readonly onEvent: () => void) {}

  start(): void {
    if (this.watcher) return
    try {
      this.watcher = chokidar.watch('/Volumes', {
        ignoreInitial: true,
        depth: 0,
        persistent: true
      })
      this.watcher.on('addDir', this.onEvent)
      this.watcher.on('unlinkDir', this.onEvent)
      this.watcher.on('error', (error) => {
        console.error('[tidy] volume watcher error:', error)
      })
    } catch (error) {
      console.error('[tidy] failed to watch /Volumes:', error)
    }
  }

  dispose(): void {
    void this.watcher?.close().catch(() => {})
    this.watcher = null
  }
}
