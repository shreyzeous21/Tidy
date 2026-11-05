import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowUp, FolderInput, ListFilter, Loader2, SearchX, FolderOpen, FolderPlus, SquareTerminal, Eye, EyeOff, PencilLine } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FileTable } from '@/components/files/FileTable'
import type { TableMenuItem } from '@/components/files/FileTable'
import { Breadcrumbs } from '@/components/files/Breadcrumbs'
import { RenameDialog } from '@/components/dialogs/RenameDialog'
import { BulkRenameDialog } from '@/components/dialogs/BulkRenameDialog'
import { MoveDialog } from '@/components/dialogs/MoveDialog'
import { TrashConfirmDialog } from '@/components/dialogs/TrashConfirmDialog'
import { EmptyState, PermissionNotice } from '@/components/common/EmptyState'
import { ViewSubbar, ViewToolbar } from '@/components/common/ViewToolbar'
import { tidy, unwrap, codeOf, messageOf } from '@/lib/api'
import { baseName } from '@/lib/format'
import { cn } from 'cn'
import { useActiveTab, useBrowserStore, useMetaStore } from '@/stores/browser-store'
import { useAppStore } from '@/stores/app-store'
import { GetInfoDialog } from '@/components/dialogs/GetInfoDialog'
import { ViewerDialog } from '@/components/dialogs/ViewerDialog'
import type { FileEntry, FileKind } from '@shared/types/files'

type DialogState =
  | { kind: 'none' }
  | { kind: 'rename'; entry: FileEntry }
  | { kind: 'bulk-rename'; entries: FileEntry[] }
  | { kind: 'move'; paths: string[]; preset?: string | null; mode?: 'move' | 'copy' }
  | { kind: 'trash'; entries: FileEntry[] }
  | { kind: 'info'; path: string }
  | { kind: 'view'; path: string }

const KIND_FILTERS: Array<{ value: FileKind | 'all'; label: string }> = [
  { value: 'all', label: 'All types' },
  { value: 'document', label: 'Documents' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'audio', label: 'Audio' },
  { value: 'archive', label: 'Archives' },
  { value: 'installer', label: 'Installers' },
  { value: 'code', label: 'Code' }
]

export function FilesView() {
  const homePath = useMetaStore((s) => s.homePath)
  const folderSizes = useMetaStore((s) => s.folderSizes)
  const setFolderSize = useMetaStore((s) => s.setFolderSize)

  // Tabs: each tab keeps its own location, history, and listing.
  const tab = useActiveTab()
  const tabs = useBrowserStore((s) => s.tabs)
  const activeTabId = useBrowserStore((s) => s.activeTabId)
  const path = tab.path
  const history = tab.history
  const future = tab.future
  const entries = tab.entries
  const loading = tab.loading
  const error = tab.error
  const sort = tab.sort
  const kindFilter = tab.kindFilter
  const refreshToken = tab.refreshToken
  const { navigate, back, forward, goUp, refresh, setEntries, setLoading, setError, setSort } =
    useBrowserStore.getState()

  const quickMoveSignal = useAppStore((s) => s.quickMoveSignal)
  const setWatchedDir = useAppStore((s) => s.setWatchedDir)
  const showHiddenFiles = useAppStore((s) => s.settings?.showHiddenFiles ?? false)
  const patchSettings = useAppStore((s) => s.patchSettings)

  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(new Set())
  const anchorRef = useRef<number | null>(null)
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' })

  // Start at home.
  useEffect(() => {
    if (!path && homePath !== '/') navigate(homePath)
  }, [path, homePath, navigate])

  // Load directory contents + live watch.
  useEffect(() => {
    if (!path) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void unwrap(tidy().listDirectory(path))
      .then((listing) => {
        if (cancelled) return
        setEntries(listing.entries)
        setLoading(false)
      })
      .catch((cause) => {
        if (cancelled) return
        setEntries([])
        setError({ code: codeOf(cause), message: messageOf(cause) })
        setLoading(false)
      })
    const unsubscribe = tidy().watchDirectory(path, () => refresh())
    setWatchedDir(path)
    return () => {
      cancelled = true
      unsubscribe()
      setWatchedDir(null)
    }
  }, [path, refreshToken, navigate, refresh, setEntries, setLoading, setError, setWatchedDir])

  const visibleEntries = useMemo(() => {
    const base = showHiddenFiles ? entries : entries.filter((e) => !e.name.startsWith('.'))
    const filtered = kindFilter === 'all' ? base : base.filter((e) => e.kind === kindFilter)
    const dir = sort.direction === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      switch (sort.key) {
        case 'size':
          return (a.size - b.size) * dir
        case 'modifiedAt':
          return (a.modifiedAt - b.modifiedAt) * dir
        case 'kind':
          return a.kind.localeCompare(b.kind) * dir || a.name.localeCompare(b.name) * dir
        default:
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) * dir
      }
    })
  }, [entries, kindFilter, sort, showHiddenFiles])

  const selectedEntries = useMemo(
    () => visibleEntries.filter((e) => selectedPaths.has(e.path)),
    [visibleEntries, selectedPaths]
  )

  const clearSelection = useCallback(() => setSelectedPaths(new Set()), [])

  const handleRowClick = useCallback(
    (entry: FileEntry, index: number, event: { metaKey: boolean; shiftKey: boolean }) => {
      setSelectedPaths((current) => {
        const next = new Set(current)
        if (event.metaKey) {
          if (next.has(entry.path)) next.delete(entry.path)
          else next.add(entry.path)
          anchorRef.current = index
          return next
        }
        if (event.shiftKey && anchorRef.current !== null) {
          const [from, to] = [anchorRef.current, index].sort((a, b) => a - b)
          const range = visibleEntries.slice(from, to + 1).map((e) => e.path)
          return new Set(range)
        }
        anchorRef.current = index
        return new Set([entry.path])
      })
    },
    [visibleEntries]
  )

  const openEntry = useCallback(
    (entry: FileEntry) => {
      if (entry.isDirectory) {
        navigate(entry.path)
        return
      }
      void unwrap(tidy().openPath(entry.path)).catch((cause) =>
        toast.error(messageOf(cause))
      )
    },
    [navigate]
  )

  const trashSelected = useCallback(() => {
    if (selectedEntries.length === 0) return
    setDialog({ kind: 'trash', entries: [...selectedEntries] })
  }, [selectedEntries])

  const moveSelected = useCallback(
    (preset?: string | null) => {
      if (selectedEntries.length === 0) return
      setDialog({ kind: 'move', paths: selectedEntries.map((e) => e.path), preset })
    },
    [selectedEntries]
  )

  const previewEntry = useCallback((entry: FileEntry) => {
    void unwrap(tidy().previewFile(entry.path)).catch((cause) => toast.error(messageOf(cause)))
  }, [])

  const renameSelected = useCallback(() => {
    if (selectedEntries.length === 1) {
      setDialog({ kind: 'rename', entry: selectedEntries[0] })
    } else if (selectedEntries.length > 1) {
      setDialog({ kind: 'bulk-rename', entries: [...selectedEntries] })
    }
  }, [selectedEntries])

  const toggleHidden = useCallback(() => {
    void patchSettings({ showHiddenFiles: !showHiddenFiles })
  }, [patchSettings, showHiddenFiles])

  const newFolder = useCallback(async (): Promise<void> => {
    if (!path) return
    try {
      const created = await unwrap(tidy().createFolder(path))
      refresh()
      setSelectedPaths(new Set([created.path]))
      // Offer an immediate rename, like Finder.
      setDialog({ kind: 'rename', entry: created })
    } catch (cause) {
      toast.error(messageOf(cause))
    }
  }, [path, refresh])

  const duplicateEntry = useCallback((entry: FileEntry) => {
    void unwrap(tidy().duplicateItem(entry.path))
      .then(() => refresh())
      .catch((cause) => toast.error(messageOf(cause)))
  }, [refresh])

  const openInTerminal = useCallback(
    (entry: FileEntry | null) => {
      const target = entry?.path ?? path
      if (!target) return
      void unwrap(tidy().openInTerminal(target)).catch((cause) => toast.error(messageOf(cause)))
    },
    [path]
  )

  const calculateFolderSize = useCallback(
    (entry: FileEntry) => {
      void unwrap(tidy().getFolderSize(entry.path))
        .then((size) => {
          setFolderSize(entry.path, size)
          toast.success(`${entry.name}: ${size.bytes.toLocaleString()} bytes in ${size.files.toLocaleString()} files${size.truncated ? ' (partial)' : ''}`)
        })
        .catch((cause) => toast.error(messageOf(cause)))
    },
    [setFolderSize]
  )

  const compressSelected = useCallback(
    (entry: FileEntry) => {
      const multi = selectedPaths.has(entry.path) && selectedEntries.length > 1
      const targets = multi ? selectedEntries : [entry]
      void unwrap(tidy().compressItems(targets.map((e) => e.path)))
        .then((created) => {
          toast.success(`Created ${created.name}`)
          refresh()
        })
        .catch((cause) => toast.error(messageOf(cause)))
    },
    [selectedPaths, selectedEntries, refresh]
  )

  const extractEntry = useCallback(
    (entry: FileEntry) => {
      void unwrap(tidy().extractArchive(entry.path))
        .then(() => {
          toast.success('Archive extracted')
          refresh()
        })
        .catch((cause) => toast.error(messageOf(cause)))
    },
    [refresh]
  )

  // Quick Move signal from the global shortcut (⌘⇧M) — a discrete external
  // event translated into dialog state.
  useEffect(() => {
    if (quickMoveSignal > 0 && selectedEntries.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      moveSelected(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickMoveSignal])

  // Get Info signal (⌘I).
  const getInfoSignal = useAppStore((s) => s.getInfoSignal)
  useEffect(() => {
    if (getInfoSignal > 0 && selectedEntries.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDialog({ kind: 'info', path: selectedEntries[0].path })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getInfoSignal])

  const buildMenu = useCallback(
    (entry: FileEntry): TableMenuItem[] => {
      const multi = selectedPaths.has(entry.path) && selectedEntries.length > 1
      const target = multi ? selectedEntries : [entry]
      return [
        { label: entry.isDirectory && !multi ? 'Open' : 'Open', onSelect: () => openEntry(entry) },
        {
          label: 'Quick Look',
          disabled: multi || entry.isDirectory,
          onSelect: () => previewEntry(entry)
        },
        { label: 'Get Info', disabled: multi, onSelect: () => setDialog({ kind: 'info', path: entry.path }) },
        { label: 'Reveal in Finder', onSelect: () => void unwrap(tidy().revealInFinder(entry.path)).catch(() => {}) },
        { label: 'Open in Terminal', onSelect: () => openInTerminal(multi ? null : entry) },
        {
          label: multi ? `Copy Paths (${target.length})` : 'Copy Path',
          onSelect: () => {
            const text = target.map((e) => e.path).join('\n')
            void navigator.clipboard.writeText(text).then(
              () => toast.success(multi ? 'Paths copied' : 'Path copied'),
              () => toast.error('Could not copy to the clipboard.')
            )
          }
        },
        {
          label: 'Duplicate',
          separatorBefore: true,
          disabled: multi,
          onSelect: () => duplicateEntry(entry)
        },
        {
          label: 'Calculate Folder Size',
          disabled: !entry.isDirectory,
          onSelect: () => calculateFolderSize(entry)
        },
        {
          label: 'Compress…',
          onSelect: () => compressSelected(entry)
        },
        {
          label: 'Extract',
          disabled: multi || !entry.name.toLowerCase().endsWith('.zip'),
          onSelect: () => extractEntry(entry)
        },
        {
          label: 'Rename…',
          separatorBefore: true,
          disabled: multi,
          onSelect: () => setDialog({ kind: 'rename', entry })
        },
        {
          label: 'Move…',
          onSelect: () => setDialog({ kind: 'move', paths: target.map((e) => e.path), preset: null, mode: 'move' })
        },
        {
          label: 'Copy to…',
          onSelect: () => setDialog({ kind: 'move', paths: target.map((e) => e.path), preset: null, mode: 'copy' })
        },
        {
          label: 'Move to Trash',
          destructive: true,
          onSelect: () => setDialog({ kind: 'trash', entries: target })
        }
      ]
    },
    [
      selectedPaths,
      selectedEntries,
      openEntry,
      previewEntry,
      openInTerminal,
      duplicateEntry,
      calculateFolderSize,
      compressSelected,
      extractEntry
    ]
  )

  const onDropOnFolder = useCallback(
    (targetDir: string) => {
      const paths = [...selectedPaths]
      if (paths.length === 0) return
      if (paths.some((p) => p === targetDir || p.startsWith(targetDir + '/'))) return
      setDialog({ kind: 'move', paths, preset: targetDir })
    },
    [selectedPaths]
  )

  const onContainerKeyDown = (event: React.KeyboardEvent): void => {
    if (event.metaKey && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      setSelectedPaths(new Set(visibleEntries.map((e) => e.path)))
      return
    }
    if (event.key === 'Escape') {
      clearSelection()
      return
    }
    if (event.metaKey && event.key === 'Backspace' && selectedEntries.length > 0) {
      event.preventDefault()
      trashSelected()
      return
    }
    if (event.metaKey && event.key === 'ArrowUp') {
      event.preventDefault()
      goUp()
    }
  }

  const errorIsPermission = error?.code === 'PERMISSION_DENIED'

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Tab strip */}
      <ViewToolbar role="tablist" aria-label="Folder tabs" className="gap-1">
        {tabs.map((t) => (
          <div key={t.id} className="group/tab relative">
            <button
              type="button"
              role="tab"
              aria-selected={t.id === activeTabId}
              onClick={() => useBrowserStore.getState().setActiveTab(t.id)}
              onAuxClick={(event) => {
                if (event.button === 1) useBrowserStore.getState().closeTab(t.id)
              }}
              className={cn(
                'flex h-7 max-w-52 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring',
                t.id === activeTabId
                  ? 'border-border bg-foreground/[0.06] text-foreground'
                  : 'border-transparent text-muted-foreground hover:bg-foreground/5'
              )}
              title={t.path ?? 'Home'}
            >
              <span className="truncate">{t.path ? baseName(t.path) : 'Home'}</span>
            </button>
            {tabs.length > 1 || t.path ? (
              <button
                type="button"
                aria-label={`Close tab ${t.path ? baseName(t.path) : 'Home'}`}
                onClick={(event) => {
                  event.stopPropagation()
                  useBrowserStore.getState().closeTab(t.id)
                }}
                className="absolute -right-1 -top-1 hidden size-3.5 items-center justify-center rounded-full border border-border bg-background text-[9px] leading-none text-muted-foreground group-hover/tab:flex hover:text-foreground"
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="New tab"
              onClick={() => useBrowserStore.getState().newTab()}
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              +
            </button>
          </TooltipTrigger>
          <TooltipContent>New tab (⌘T)</TooltipContent>
        </Tooltip>
      </ViewToolbar>

      {/* Toolbar */}
      <ViewSubbar>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={back} disabled={history.length === 0}>
              <ArrowLeft className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Back</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Forward" onClick={forward} disabled={future.length === 0}>
              <ArrowRight className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Forward</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Enclosing folder"
              onClick={goUp}
              disabled={!path || path === '/'}
            >
              <ArrowUp className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Enclosing folder (⌘↑)</TooltipContent>
        </Tooltip>
        {path ? <Breadcrumbs path={path} onNavigate={navigate} onDropOnFolder={onDropOnFolder} /> : <div className="flex-1" />}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
              <ListFilter className="size-3.5" />
              {kindFilter === 'all' ? 'Type' : KIND_FILTERS.find((f) => f.value === kindFilter)?.label}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={kindFilter}
              onValueChange={(v) => useBrowserStore.getState().setKindFilter(v as FileKind | 'all')}
            >
              {KIND_FILTERS.map((f) => (
                <DropdownMenuRadioItem key={f.value} value={f.value}>
                  {f.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="New folder" onClick={() => void newFolder()}>
              <FolderPlus className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New folder</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={showHiddenFiles ? 'Hide hidden files' : 'Show hidden files'}
              onClick={toggleHidden}
            >
              {showHiddenFiles ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{showHiddenFiles ? 'Hide' : 'Show'} hidden files (⌘⇧.)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Rename"
              disabled={selectedEntries.length === 0}
              onClick={renameSelected}
            >
              <PencilLine className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {selectedEntries.length > 1 ? `Bulk rename ${selectedEntries.length} items` : 'Rename'}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open in Terminal"
              onClick={() => openInTerminal(null)}
            >
              <SquareTerminal className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open in Terminal</TooltipContent>
        </Tooltip>
        <Button
          size="sm"
          className="gap-1.5 text-xs"
          disabled={selectedEntries.length === 0}
          onClick={() => moveSelected(null)}
        >
          <FolderInput className="size-3.5" />
          Move{selectedEntries.length > 0 ? ` (${selectedEntries.length})` : ''}
        </Button>
      </ViewSubbar>

      {error ? (
        <div className="space-y-3 px-4 py-3">
          <PermissionNotice message={error.message} className={errorIsPermission ? undefined : 'hidden'} />
          {!errorIsPermission ? (
            <p className="text-xs text-muted-foreground">{error.message}</p>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : (
        <FileTable
          ariaLabel={`Contents of ${path ?? ''}`}
          entries={visibleEntries}
          selectedPaths={selectedPaths}
          onRowClick={handleRowClick}
          onOpen={openEntry}
          buildMenu={buildMenu}
          sort={sort}
          onSortChange={setSort}
          getDragPaths={() => (selectedPaths.size > 0 ? [...selectedPaths] : null)}
          onDropOnFolder={onDropOnFolder}
          onPreview={previewEntry}
          folderSizes={folderSizes}
          onKeyDown={onContainerKeyDown}
          emptyState={
            error ? (
              <EmptyState icon={SearchX} title="Can’t open this folder" description={error.message} />
            ) : (
              <EmptyState
                icon={FolderOpen}
                title="Empty folder"
                description="This folder has no items. Drop files onto folder rows or crumbs to move them."
              />
            )
          }
        />
      )}

      {/* Dialogs */}
      {dialog.kind === 'bulk-rename' ? (
        <BulkRenameDialog
          entries={dialog.entries}
          existingNames={entries.map((e) => e.name)}
          onClose={(renamed) => {
            setDialog({ kind: 'none' })
            clearSelection()
            if (renamed) refresh()
          }}
        />
      ) : null}
      {dialog.kind === 'rename' ? (
        <RenameDialog
          path={dialog.entry.path}
          currentName={dialog.entry.name}
          onClose={(renamed) => {
            setDialog({ kind: 'none' })
            clearSelection()
            if (renamed) refresh()
          }}
        />
      ) : null}
      {dialog.kind === 'move' ? (
        <MoveDialog
          paths={dialog.paths}
          presetDestination={dialog.preset ?? null}
          mode={dialog.mode ?? 'move'}
          onClose={(movedAny) => {
            setDialog({ kind: 'none' })
            clearSelection()
            if (movedAny) refresh()
          }}
        />
      ) : null}
      {dialog.kind === 'info' ? <GetInfoDialog path={dialog.path} onClose={() => setDialog({ kind: 'none' })} /> : null}
      {dialog.kind === 'view' ? <ViewerDialog path={dialog.path} onClose={() => setDialog({ kind: 'none' })} /> : null}
      {dialog.kind === 'trash' ? (
        <TrashConfirmDialog
          items={dialog.entries.map((e) => ({ path: e.path, size: e.size }))}
          onClose={(trashed) => {
            setDialog({ kind: 'none' })
            clearSelection()
            if (trashed) refresh()
          }}
        />
      ) : null}
    </div>
  )
}
