import type { FileManagerAPI } from '@shared/types/api'
import type { AppErrorShape, ApiResult } from '@shared/types/files'

/** Access the typed preload API, with a clear failure when run outside Electron. */
export function tidy(): FileManagerAPI {
  if (!window.tidy) {
    throw new Error('Tidy API is unavailable. The renderer must run inside the Tidy Electron app.')
  }
  return window.tidy
}

/** Error carrying a structured code from the main process. */
export class ApiError extends Error {
  readonly code: AppErrorShape['code']

  constructor(shape: AppErrorShape) {
    super(shape.message)
    this.code = shape.code
    this.name = 'ApiError'
  }
}

/** Unwrap an ApiResult promise; throws ApiError on failure. */
export async function unwrap<T>(call: Promise<ApiResult<T>>): Promise<T> {
  const result = await call
  if (!result.ok) throw new ApiError(result.error)
  return result.data
}

/** Best-effort human message from any thrown value. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}

export function codeOf(error: unknown): AppErrorShape['code'] {
  return error instanceof ApiError ? error.code : 'UNKNOWN'
}
