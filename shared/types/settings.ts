import type { DownloadCategory } from './files'
import type { SearchFiltersState } from './search'

export type ThemePreference = 'system' | 'light' | 'dark'

/** Accent color choices for the interface. */
export type AccentId = 'blue' | 'teal' | 'purple' | 'rose' | 'orange' | 'graphite'

export interface AppSettings {
  theme: ThemePreference
  accent: AccentId
  /** Folders pinned for Quick Move destinations. */
  pinnedFolders: string[]
  /** Most recent move destinations (bounded, most recent first). */
  recentDestinations: string[]
  /** Default large-file threshold in MB used by Clean Up. */
  largeFileThresholdMB: number
  /** Minimum size (MB) for duplicate candidate scanning. */
  duplicateMinSizeMB: number
  /** Per-category destination for Downloads organizing. Missing = unset. */
  downloadsDestinations: Partial<Record<DownloadCategory, string>>
  /**
   * Extra roots the user granted through a native folder picker. Write
   * operations are limited to the home directory plus these roots.
   */
  approvedRoots: string[]
  /** Search filter defaults persisted between sessions. */
  lastSearchFilters?: Partial<SearchFiltersState>
  /** Show dotfiles in the Files browser (⌘⇧.). */
  showHiddenFiles: boolean
  /** Recent non-empty search queries (bounded). */
  recentSearches: string[]
  /** User-saved searches. */
  savedSearches: SavedSearch[]
  /** Rule-based organization rules, applied in Downloads organizing. */
  orgRules: OrgRule[]
  /** True once the first-run permission onboarding has been completed or skipped. */
  onboardingCompleted: boolean
}

export interface SavedSearch {
  id: string
  name: string
  query: string
  kind: string
  location: string | null
  minSize: string
  maxSize: string
  modifiedWithin: string
}

/** A reusable organization rule; first matching rule wins. */
export interface OrgRule {
  id: string
  enabled: boolean
  /** Matches this Downloads category, or any when "any". */
  category: DownloadCategory | 'any'
  /** Case-insensitive substring the filename must contain (optional). */
  nameContains: string
  destination: string
}

export interface OperationHistoryItem {
  id: string
  /** ISO timestamp. */
  at: string
  type: 'rename' | 'move' | 'trash'
  /** Human-readable summary, e.g. "report.pdf → ~/Documents". */
  summary: string
  count: number
}
