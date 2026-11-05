import type { TidyAPI } from './index'

declare global {
  interface Window {
    /** Typed, sandboxed API exposed by Tidy's preload script. */
    tidy: TidyAPI
  }
}

export {}
