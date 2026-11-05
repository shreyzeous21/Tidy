import { ipcMain } from 'electron'
import type { SearchOptions } from '@shared/types/search'
import { guard } from '../utils/errors'
import { normalizePath } from '../utils/path-validation'
import { searchFiles, mdfindAvailable } from '../services/search'

/** Search IPC. The only field needing deep validation is the location path. */
export function registerSearchHandlers(): void {
  ipcMain.handle('search:query', (_event, options: unknown) =>
    guard(async () => {
      if (!options || typeof options !== 'object') {
        return { results: [], source: 'local' as const, truncated: false, parsedHints: [] }
      }
      const opts = options as SearchOptions
      const safe: SearchOptions = {
        query: typeof opts.query === 'string' ? opts.query.slice(0, 300) : '',
        location: opts.location ? normalizePath(opts.location, 'search location') : undefined,
        kinds: Array.isArray(opts.kinds) ? opts.kinds.slice(0, 10) : undefined,
        minSizeBytes: finiteNumber(opts.minSizeBytes),
        maxSizeBytes: finiteNumber(opts.maxSizeBytes),
        modifiedWithinDays: finiteNumber(opts.modifiedWithinDays),
        limit: 300
      }
      return searchFiles(safe)
    })
  )

  ipcMain.handle('search:mdfind-available', () => guard(async () => mdfindAvailable()))
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}
