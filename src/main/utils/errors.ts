import type { AppErrorShape } from '@shared/types/files'

/** Application error carrying a stable code across IPC. */
export class AppError extends Error {
  readonly code: AppErrorShape['code']

  constructor(code: AppErrorShape['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'AppError'
  }

  toShape(): AppErrorShape {
    return { code: this.code, message: this.message }
  }
}

/** Map a caught error (fs error, string, AppError…) into an AppErrorShape. */
export function toAppErrorShape(error: unknown): AppErrorShape {
  if (error instanceof AppError) return error.toShape()
  if (error && typeof error === 'object' && 'code' in error) {
    const fsCode = String((error as NodeJS.ErrnoException).code ?? '')
    const message = error instanceof Error ? error.message : 'Unknown file system error.'
    switch (fsCode) {
      case 'EPERM':
      case 'EACCES':
        return {
          code: 'PERMISSION_DENIED',
          message: permissionMessage()
        }
      case 'ENOENT':
        return { code: 'NOT_FOUND', message: 'That item no longer exists.' }
      case 'EEXIST':
        return { code: 'ALREADY_EXISTS', message: 'An item with that name already exists.' }
      case 'ENOTEMPTY':
      case 'EBUSY':
        return {
          code: 'CONFLICT',
          message: 'The item is busy or cannot be modified right now.'
        }
      case 'ENOSPC':
        return { code: 'DISK_FULL', message: 'The destination disk is full.' }
      case 'EXDEV':
        return { code: 'UNSUPPORTED', message: 'Item spans two volumes.' }
      case 'EINVAL':
      case 'EBADF':
        return { code: 'INVALID_INPUT', message }
      default:
        return { code: 'UNKNOWN', message }
    }
  }
  return {
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : 'Something went wrong.'
  }
}

function permissionMessage(): string {
  return 'macOS blocked access to this folder. Grant Tidy access in System Settings → Privacy & Security → Files and Folders (or Full Disk Access), then try again.'
}

/**
 * Wrap an IPC handler body so every failure crosses the boundary as a
 * structured ApiResult instead of an opaque thrown error.
 */
export async function guard<T>(fn: () => Promise<T>): Promise<
  { ok: true; data: T } | { ok: false; error: AppErrorShape }
> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    // Log in the main process so failures are diagnosable; never swallow silently.
    console.error('[tidy] IPC error:', error)
    return { ok: false, error: toAppErrorShape(error) }
  }
}
