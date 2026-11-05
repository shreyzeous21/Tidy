import type { AppSettings } from '@shared/types/settings'
import type { CancelRegistry } from '../services/cleanup'
import type { FileWatcher } from '../services/file-watcher'
import { loadSettings, saveSettings } from '../services/storage'

/**
 * Shared state handed to every IPC handler module. Settings are cached in
 * the main process (single source of truth) and persisted atomically.
 */
export interface HandlerContext {
  settings: AppSettings
  watcher: FileWatcher
  cancels: CancelRegistry
  persist(next: AppSettings): Promise<void>
}

export async function createHandlerContext(
  watcher: FileWatcher,
  cancels: CancelRegistry
): Promise<HandlerContext> {
  const settings = await loadSettings()
  const ctx: HandlerContext = {
    settings,
    watcher,
    cancels,
    persist: async (next: AppSettings) => {
      ctx.settings = next
      await saveSettings(next)
    }
  }
  return ctx
}
