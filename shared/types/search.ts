import type { FileKind, SortKey, SortDirection } from './files'

export type SizeUnit = 'KB' | 'MB' | 'GB'

export interface SearchOptions {
  /** Filename search term. May include light natural phrases like "pdf larger than 20 mb". */
  query: string
  /** Restrict search to this folder (defaults to the user's home directory). */
  location?: string
  /** Filter by file kinds. */
  kinds?: FileKind[]
  /** Minimum size in bytes. */
  minSizeBytes?: number
  /** Maximum size in bytes. */
  maxSizeBytes?: number
  /** Modified within the last N days. */
  modifiedWithinDays?: number
  /**
   * Also search inside file contents. Requires Spotlight (mdfind);
   * a local-walk fallback for contents is not implemented.
   */
  includeContents?: boolean
  limit?: number
}

export interface SearchFiltersState {
  kind: FileKind | 'all'
  location: string | null
  minSize: { value: number | null; unit: SizeUnit }
  maxSize: { value: number | null; unit: SizeUnit }
  modifiedWithin: 1 | 7 | 30 | null
}

export interface SearchResponse {
  results: Array<{
    name: string
    path: string
    isDirectory: boolean
    size: number
    modifiedAt: number
    kind: FileKind
    extension: string
  }>
  /** Which engine produced the results. */
  source: 'spotlight' | 'local'
  /** True when results were capped and may be incomplete. */
  truncated: boolean
  /** Parsed structured filters extracted from the query, shown back to the user. */
  parsedHints: string[]
  sort?: { key: SortKey; direction: SortDirection }
}
