import type { FileManagerAPI } from '@shared/types/api'

declare global {
  interface Window {
    /** Typed, sandboxed API exposed by Tidy's preload script. */
    tidy: FileManagerAPI
  }
}

export {}
