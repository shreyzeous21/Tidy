import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search as SearchIcon, Loader2, Sparkles, TriangleAlert, HardDrive, Bookmark, X } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FileTable } from '@/components/files/FileTable'
import type { TableMenuItem } from '@/components/files/FileTable'
import { EmptyState } from '@/components/common/EmptyState'
import { ViewSubbar, ViewToolbar } from '@/components/common/ViewToolbar'
import { tidy, unwrap, messageOf } from '@/lib/api'
import { useDebouncedValue } from '@/hooks/use-debounce'
import { useAppStore } from '@/stores/app-store'
import { useMetaStore } from '@/stores/browser-store'
import type { FileEntry, FileKind } from '@shared/types/files'
import type { SearchResponse, SizeUnit } from '@shared/types/search'

const UNIT_BYTES: Record<SizeUnit, number> = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }

const KIND_OPTIONS: Array<{ value: FileKind | 'all'; label: string }> = [
  { value: 'all', label: 'Any kind' },
  { value: 'document', label: 'Documents' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'audio', label: 'Audio' },
  { value: 'archive', label: 'Archives' },
  { value: 'installer', label: 'Installers' }
]

const UNIT_OPTIONS: SizeUnit[] = ['KB', 'MB', 'GB']

function toEntry(result: SearchResponse['results'][number]): FileEntry {
  return { ...result, isSymlink: false }
}

export function SearchView() {
  const homePath = useMetaStore((s) => s.homePath)
  const homeFolders = useMetaStore((s) => s.homeFolders)
  const searchFocusSignal = useAppStore((s) => s.searchFocusSignal)
  const settings = useAppStore((s) => s.settings)
  const patchSettings = useAppStore((s) => s.patchSettings)
  const seedSearch = useAppStore((s) => s.seedSearch)
  const clearSeedSearch = useAppStore((s) => s.clearSeedSearch)

  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<FileKind | 'all'>('all')
  const [location, setLocation] = useState<string | null>(null)
  const [minSize, setMinSize] = useState<{ value: string; unit: SizeUnit }>({ value: '', unit: 'MB' })
  const [maxSize, setMaxSize] = useState<{ value: string; unit: SizeUnit }>({ value: '', unit: 'MB' })
  const [modifiedWithin, setModifiedWithin] = useState<'1' | '7' | '30' | 'any'>('any')
  const [includeContents, setIncludeContents] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [saveName, setSaveName] = useState('')

  const [results, setResults] = useState<FileEntry[]>([])
  const [source, setSource] = useState<'spotlight' | 'local' | null>(null)
  const [hints, setHints] = useState<string[]>([])
  const [truncated, setTruncated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(new Set())
  const requestId = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // ⌘F moves focus here.
  useEffect(() => {
    if (searchFocusSignal > 0) inputRef.current?.focus()
  }, [searchFocusSignal])

  const effectiveLocation = location ?? homePath
  const debouncedQuery = useDebouncedValue(query.trim(), 350)

  const hasFilters =
    kind !== 'all' ||
    minSize.value !== '' ||
    maxSize.value !== '' ||
    modifiedWithin !== 'any' ||
    Boolean(location)

  const runSearch = useCallback(async (): Promise<void> => {
    const term = debouncedQuery
    if (!term && !hasFilters) {
      setResults([])
      setSource(null)
      setHints([])
      setError(null)
      return
    }
    const id = ++requestId.current
    setBusy(true)
    setError(null)
    try {
      const minBytes = minSize.value !== '' && Number(minSize.value) > 0 ? Number(minSize.value) * UNIT_BYTES[minSize.unit] : undefined
      const maxBytes = maxSize.value !== '' && Number(maxSize.value) > 0 ? Number(maxSize.value) * UNIT_BYTES[maxSize.unit] : undefined
      const response = await unwrap(
        tidy().searchFiles({
          query: term,
          location: effectiveLocation,
          kinds: kind === 'all' ? undefined : [kind],
          minSizeBytes: minBytes,
          maxSizeBytes: maxBytes,
          modifiedWithinDays: modifiedWithin === 'any' ? undefined : Number(modifiedWithin),
          includeContents
        })
      )
      if (requestId.current !== id) return
      setResults(response.results.map(toEntry))
      setSource(response.source)
      setHints(response.parsedHints)
      setTruncated(response.truncated)
      // Record non-empty filename queries for one-click recall.
      if (term && !includeContents) {
        const old = useAppStore.getState().settings?.recentSearches ?? []
        if (old[0] !== term) {
          void patchSettings({ recentSearches: [term, ...old.filter((q) => q !== term)].slice(0, 8) })
        }
      }
    } catch (cause) {
      if (requestId.current !== id) return
      setResults([])
      setError(messageOf(cause))
    } finally {
      if (requestId.current === id) setBusy(false)
    }
  }, [debouncedQuery, hasFilters, kind, minSize.value, minSize.unit, maxSize.value, maxSize.unit, modifiedWithin, effectiveLocation, includeContents, patchSettings])

  // Debounced auto-run.
  useEffect(() => {
    // Search-as-you-type is an intentional effect-driven fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runSearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, kind, minSize.value, minSize.unit, maxSize.value, maxSize.unit, modifiedWithin, effectiveLocation, includeContents])

  // A saved search chosen from the palette or chips fills the form.
  useEffect(() => {
    if (!seedSearch) return
    const data = seedSearch.data
    // Applying a saved search intentionally resets the form fields.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery(data.query)
    setKind((data.kind as FileKind | 'all') ?? 'all')
    setLocation(data.location)
    setMinSize({ value: data.minSize ?? '', unit: 'MB' })
    setMaxSize({ value: data.maxSize ?? '', unit: 'MB' })
    setModifiedWithin((data.modifiedWithin as '1' | '7' | '30' | 'any') ?? 'any')
    clearSeedSearch()
  }, [seedSearch, clearSeedSearch])

  const saveCurrentSearch = (): void => {
    const name = saveName.trim() || query.trim() || `Search ${new Date().toLocaleDateString()}`
    const saved = {
      id: `saved-${Date.now()}`,
      name,
      query: query.trim(),
      kind,
      location,
      minSize: minSize.value,
      maxSize: maxSize.value,
      modifiedWithin
    }
    const existing = settings?.savedSearches ?? []
    void patchSettings({ savedSearches: [saved, ...existing].slice(0, 20) })
    setSaveDialogOpen(false)
    setSaveName('')
    toast.success(`Saved “${name}”`)
  }

  const openEntry = (entry: FileEntry): void => {
    if (entry.isDirectory) {
      toast('Open the Files view to browse folders found by search.', {
        description: entry.path
      })
      return
    }
    void unwrap(tidy().openPath(entry.path)).catch((cause) => toast.error(messageOf(cause)))
  }

  const previewEntry = (entry: FileEntry): void => {
    void unwrap(tidy().previewFile(entry.path)).catch((cause) => toast.error(messageOf(cause)))
  }

  const buildMenu = (entry: FileEntry): TableMenuItem[] => [
    { label: 'Open', onSelect: () => openEntry(entry) },
    {
      label: 'Quick Look',
      disabled: entry.isDirectory,
      onSelect: () => previewEntry(entry)
    },
    { label: 'Reveal in Finder', onSelect: () => void unwrap(tidy().revealInFinder(entry.path)).catch(() => {}) },
    {
      label: 'Copy Path',
      onSelect: () => {
        void navigator.clipboard.writeText(entry.path).then(
          () => toast.success('Path copied'),
          () => toast.error('Could not copy to the clipboard.')
        )
      }
    }
  ]

  const sourceBadge = useMemo(() => {
    if (!source) return null
    return source === 'spotlight' ? (
      <Badge variant="secondary" className="gap-1 text-[11px]">
        <Sparkles className="size-3" /> Spotlight
      </Badge>
    ) : (
      <Badge variant="secondary" className="gap-1 text-[11px]">
        <HardDrive className="size-3" /> Local scan
      </Badge>
    )
  }, [source])

  const searchIsEmpty = !debouncedQuery && !hasFilters

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewToolbar>
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search file names"
            className="h-8 pl-8 text-xs"
            aria-label="Search files by name"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </ViewToolbar>

      <ViewSubbar>
        <Select value={kind} onValueChange={(v) => setKind(v as FileKind | 'all')}>
            <SelectTrigger size="sm" className="w-32" aria-label="Kind filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KIND_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <SizeInput
            label="Larger than"
            value={minSize.value}
            unit={minSize.unit}
            onValue={(value) => setMinSize((s) => ({ ...s, value }))}
            onUnit={(unit) => setMinSize((s) => ({ ...s, unit }))}
          />
          <SizeInput
            label="Smaller than"
            value={maxSize.value}
            unit={maxSize.unit}
            onValue={(value) => setMaxSize((s) => ({ ...s, value }))}
            onUnit={(unit) => setMaxSize((s) => ({ ...s, unit }))}
          />

          <Select value={modifiedWithin} onValueChange={(v) => setModifiedWithin(v as typeof modifiedWithin)}>
            <SelectTrigger size="sm" className="w-40" aria-label="Modified within">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any date</SelectItem>
              <SelectItem value="1">Today</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
            </SelectContent>
          </Select>

          <Tooltip>
            <TooltipTrigger asChild>
              <Select
                value={location ?? '__home__'}
                onValueChange={(v) => setLocation(v === '__home__' ? null : v)}
              >
                <SelectTrigger size="sm" className="w-44" aria-label="Search location">
                  <SelectValue placeholder="Search location" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__home__">Entire home folder</SelectItem>
                  {homeFolders.map((folder) => (
                    <SelectItem key={folder.path} value={folder.path}>
                      {folder.name} only
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </TooltipTrigger>
            <TooltipContent>Where to search</TooltipContent>
          </Tooltip>

          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Checkbox
              checked={includeContents}
              onCheckedChange={(v) => setIncludeContents(v === true)}
              aria-label="Search inside file contents (Spotlight)"
            />
            Inside files
          </label>

          <div className="ml-auto flex items-center gap-2">
            {sourceBadge}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Save this search"
                  disabled={searchIsEmpty}
                  onClick={() => setSaveDialogOpen(true)}
                >
                  <Bookmark className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Save this search</TooltipContent>
            </Tooltip>
          </div>
        {hints.length > 0 ? (
          <div className="flex w-full flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            <span>Understood as:</span>
            {hints.map((hint) => (
              <Badge key={hint} variant="outline" className="text-[11px] font-normal">
                {hint}
              </Badge>
            ))}
          </div>
        ) : null}
      </ViewSubbar>

      {busy ? (
        <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Searching…
        </div>
      ) : null}
      {error ? (
        <p className="px-4 py-2 text-xs text-destructive">{error}</p>
      ) : null}
      {truncated && !busy ? (
        <p className="flex items-center gap-1.5 px-4 py-1 text-[11px] text-muted-foreground">
          <TriangleAlert className="size-3" /> Results were limited to keep things fast — narrow the filters to see more.
        </p>
      ) : null}

      {!busy && !error && results.length === 0 ? (
        searchIsEmpty ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-6">
            <EmptyState
              icon={SearchIcon}
              title="Search your files"
              description="Type part of a filename, use filters, or pick something below."
              className="py-4"
            />
            {(settings?.recentSearches.length ?? 0) > 0 ? (
              <div className="w-full max-w-lg">
                <p className="mb-1.5 text-[11px] font-medium text-muted-foreground/70">Recent searches</p>
                <div className="flex flex-wrap gap-1.5">
                  {settings!.recentSearches.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setQuery(q)}
                      className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {(settings?.savedSearches.length ?? 0) > 0 ? (
              <div className="w-full max-w-lg">
                <p className="mb-1.5 text-[11px] font-medium text-muted-foreground/70">Saved searches</p>
                <div className="flex flex-wrap gap-1.5">
                  {settings!.savedSearches.map((saved) => (
                    <span
                      key={saved.id}
                      className="flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs text-primary"
                    >
                      <button type="button" onClick={() => useAppStore.getState().applySavedSearch(saved)}>
                        {saved.name}
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete saved search ${saved.name}`}
                        onClick={() =>
                          void patchSettings({
                            savedSearches: settings!.savedSearches.filter((s) => s.id !== saved.id)
                          })
                        }
                        className="rounded-full p-0.5 hover:bg-primary/10"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState
            icon={SearchIcon}
            title="No matching files"
            description="Try a shorter name, or loosen the size and date filters."
          />
        )
      ) : (
        <FileTable
          ariaLabel="Search results"
          entries={results}
          selectedPaths={selectedPaths}
          onRowClick={(entry) => setSelectedPaths(new Set([entry.path]))}
          onOpen={openEntry}
          buildMenu={buildMenu}
          onPreview={previewEntry}
          showPath
        />
      )}

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save this search</DialogTitle>
          </DialogHeader>
          <Input
            value={saveName}
            onChange={(event) => setSaveName(event.target.value)}
            placeholder={query.trim() || 'Name this search'}
            aria-label="Search name"
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveCurrentSearch()
            }}
          />
          <p className="text-[11px] text-muted-foreground">
            Saves the current query, kind, location, size, and date filters.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveCurrentSearch}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SizeInput({
  label,
  value,
  unit,
  onValue,
  onUnit
}: {
  label: string
  value: string
  unit: SizeUnit
  onValue: (value: string) => void
  onUnit: (unit: SizeUnit) => void
}) {
  return (
    <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
      {label}
      <Input
        value={value}
        onChange={(event) => onValue(event.target.value.replace(/[^\d.]/g, ''))}
        className="h-7 w-16 px-2 text-xs"
        inputMode="decimal"
        aria-label={label}
        placeholder="—"
      />
      <Select value={unit} onValueChange={(v) => onUnit(v as SizeUnit)}>
        <SelectTrigger size="sm" className="w-16" aria-label={`${label} unit`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {UNIT_OPTIONS.map((u) => (
            <SelectItem key={u} value={u}>
              {u}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}
