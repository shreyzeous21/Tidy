import path from 'node:path'
import os from 'node:os'
import { AppError } from './errors'

/**
 * Path validation for every IPC filesystem call.
 *
 * Policy:
 * - All paths must be absolute strings without NUL bytes.
 * - A leading `~` is expanded to the user's home directory.
 * - Reads are permitted anywhere (mirrors Finder).
 * - Writes (rename/move destination/trash source) must land inside an
 *   *approved root*: the user's home directory, or a folder explicitly
 *   granted via a native folder picker (persisted in settings).
 */

const MAX_PATH_LENGTH = 4096

export function expandHome(input: string): string {
  if (input === '~') return os.homedir()
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2))
  return input
}

/** Validate + normalize a path for any operation. Throws AppError on bad input. */
export function normalizePath(input: unknown, label = 'path'): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new AppError('INVALID_INPUT', `Invalid ${label}: expected a non-empty string.`)
  }
  if (input.includes('\0')) {
    throw new AppError('INVALID_INPUT', `Invalid ${label}: NUL byte.`)
  }
  if (input.length > MAX_PATH_LENGTH) {
    throw new AppError('INVALID_INPUT', `Invalid ${label}: too long.`)
  }
  const expanded = expandHome(input)
  const resolved = path.resolve(expanded)
  // '/' is allowed for *reads* (Macintosh HD browsing); write operations are
  // gated separately by assertWritable, which '/' never passes.
  if (resolved.length === 0) {
    throw new AppError('INVALID_INPUT', 'Invalid path.')
  }
  return resolved
}

export function isValidName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 255 &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes(':') &&
    !name.includes('\0')
  )
}

/**
 * Approved roots for write operations: the home directory plus folders the
 * user granted through the app's own folder picker.
 */
export function isWithinApprovedRoots(target: string, approvedRoots: string[]): boolean {
  const resolved = path.resolve(expandHome(target))
  const home = os.homedir()
  if (resolved === home || resolved.startsWith(home + path.sep)) return true
  return approvedRoots.some((root) => {
    const r = path.resolve(expandHome(root))
    return resolved === r || resolved.startsWith(r + path.sep)
  })
}

/** Throws unless the target may be written/trashed under current policy. */
export function assertWritable(target: string, approvedRoots: string[]): void {
  if (!isWithinApprovedRoots(target, approvedRoots)) {
    throw new AppError(
      'PERMISSION_DENIED',
      'Tidy can only modify files inside your home folder or folders you picked with "Choose folder…".'
    )
  }
}
