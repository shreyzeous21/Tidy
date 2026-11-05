import { useEffect, useMemo, useState } from 'react'
import { Loader2, Inbox, FolderInput } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FileTable } from '@/components/files/FileTable'
import type { TableMenuItem } from '@/components/files/FileTable'
import { MoveDialog } from '@/components/dialogs/MoveDialog'
import { TrashConfirmDialog } from '@/components/dialogs/TrashConfirmDialog'
import { EmptyState, PermissionNotice } from '@/components/common/EmptyState'
import { ViewToolbar } from '@/components/common/ViewToolbar'
import { tidy, unwrap, codeOf, messageOf } from '@/lib/api'
import { useMetaStore } from '@/stores/browser-store'
import { OrganizeDialog } from './OrganizeDialog'
import {
  DOWNLOAD_CATEGORY_LABELS,
  DOWNLOAD_CATEGORY_ORDER,
  categoryForFile
} from '@shared/constants/categories'
import type { DownloadCategory, FileEntry } from '@shared/types/files'
import { cn } from 'cn'

type DialogState =
  | { kind: 'none' }
  | { kind: 'move'; paths: string[] }
  | { kind: 'trash'; entries: FileEntry[] }
  | { kind: 'organize' }

export function DownloadsView() {
  const homePath = useMetaStore((s) => s.homePath)
  const [downloadsPath, setDownloadsPath] = useState<string | null>(null)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [category, setCategory] = useState<DownloadCategory | 'all'>('all')
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(new Set())
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' })
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    // Intentional fetch-on-mount flags.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    void unwrap(tidy().scanDownloads())
      .then((listing) => {
        if (cancelled) return
        setDownloadsPath(listing.path)
        setEntries(listing.entries)
        setLoading(false)
      })
      .catch((cause) => {
        if (cancelled) return
        setError({ code: codeOf(cause), message: messageOf(cause) })
        setLoading(false)
      })
    const unsubscribe = tidy().watchDirectory(downloadsPath, () => setRefreshToken((t) => t + 1))
    return () => {
      cancelled = true
      unsubscribe()
    }
    // Re-scan when a move/organize finished or the folder changed.
  }, [downloadsPath, refreshToken])

  const files = useMemo(() => entries.filter((e) => !e.isDirectory), [entries])
  const folders = useMemo(() => entries.filter((e) => e.isDirectory), [entries])

  const counts = useMemo(() => {
    const map = new Map<DownloadCategory | 'all', number>()
    map.set('all', files.length)
    for (const file of files) {
      const cat = categoryForFile(file.name)
      map.set(cat, (map.get(cat) ?? 0) + 1)
    }
    return map
  }, [files])

  const visible = useMemo(() => {
    const base = category === 'all' ? [...folders, ...files] : files.filter((f) => categoryForFile(f.name) === category)
    return base
  }, [category, files, folders])

  const selectedEntries = useMemo(
    () => visible.filter((e) => selectedPaths.has(e.path)),
    [visible, selectedPaths]
  )

  const openEntry = (entry: FileEntry): void => {
    if (entry.isDirectory) {
      // Hand off to the Files view via toast guidance — navigation within
      // Downloads stays single-level by design.
      void unwrap(tidy().revealInFinder(entry.path)).catch(() => {})
      return
    }
    void unwrap(tidy().openPath(entry.path)).catch((cause) => toast.error(messageOf(cause)))
  }

  const handleRowClick = (
    entry: FileEntry,
    _index: number,
    event: { metaKey: boolean; shiftKey: boolean }
  ): void => {
    setSelectedPaths((current) => {
      const next = new Set(current)
      if (event.metaKey || event.shiftKey) {
        if (next.has(entry.path)) next.delete(entry.path)
        else next.add(entry.path)
        return next
      }
      return new Set([entry.path])
    })
  }

  const previewEntry = (entry: FileEntry): void => {
    void unwrap(tidy().previewFile(entry.path)).catch((cause) => toast.error(messageOf(cause)))
  }

  const buildMenu = (entry: FileEntry): TableMenuItem[] => {
    const multi = selectedPaths.has(entry.path) && selectedEntries.length > 1
    const target = multi ? selectedEntries : [entry]
    return [
      { label: 'Open', onSelect: () => openEntry(entry) },
      {
        label: 'Quick Look',
        disabled: multi || entry.isDirectory,
        onSelect: () => previewEntry(entry)
      },
      { label: 'Reveal in Finder', onSelect: () => void unwrap(tidy().revealInFinder(entry.path)).catch(() => {}) },
      {
        label: 'Open in Terminal',
        onSelect: () => void unwrap(tidy().openInTerminal(downloadsPath ?? entry.path)).catch((c) => toast.error(messageOf(c)))
      },
      {
        label: 'Move…',
        separatorBefore: true,
        onSelect: () => setDialog({ kind: 'move', paths: target.map((e) => e.path) })
      },
      { label: 'Move to Trash', destructive: true, onSelect: () => setDialog({ kind: 'trash', entries: target }) }
    ]
  }

  const errorIsPermission = error?.code === 'PERMISSION_DENIED'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewToolbar>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          <CategoryChip
            label="All"
            count={counts.get('all') ?? 0}
            active={category === 'all'}
            onClick={() => {
              setCategory('all')
              setSelectedPaths(new Set())
            }}
          />
          {DOWNLOAD_CATEGORY_ORDER.map((cat) => {
            const count = counts.get(cat) ?? 0
            if (count === 0 && category !== cat) return null
            return (
              <CategoryChip
                key={cat}
                label={DOWNLOAD_CATEGORY_LABELS[cat]}
                count={count}
                active={category === cat}
                onClick={() => {
                  setCategory(cat)
                  setSelectedPaths(new Set())
                }}
              />
            )
          })}
        </div>
        <Button
          size="sm"
          className="gap-1.5 text-xs"
          disabled={files.length === 0}
          onClick={() => setDialog({ kind: 'organize' })}
        >
          <FolderInput className="size-3.5" />
          Organize{files.length > 0 ? ` ${files.length} files` : '…'}
        </Button>
      </ViewToolbar>

      {error ? (
        <div className="space-y-3 px-4 py-3">
          <PermissionNotice message={error.message} className={errorIsPermission ? undefined : 'hidden'} />
          {!errorIsPermission ? <p className="text-xs text-muted-foreground">{error.message}</p> : null}
        </div>
      ) : null}

      {loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Scanning Downloads…
        </div>
      ) : (
        <FileTable
          ariaLabel="Downloads"
          entries={visible}
          selectedPaths={selectedPaths}
          onRowClick={handleRowClick}
          onOpen={openEntry}
          buildMenu={buildMenu}
          onPreview={previewEntry}
          emptyState={
            error ? (
              <EmptyState icon={Inbox} title="Can’t read Downloads" description={error.message} />
            ) : (
              <EmptyState
                icon={Inbox}
                title={category === 'all' ? 'Downloads is empty' : `No ${DOWNLOAD_CATEGORY_LABELS[category].toLowerCase()} in Downloads`}
                description={
                  category === 'all'
                    ? 'New downloads will appear here automatically.'
                    : 'Try the “All” filter to see everything.'
                }
              />
            )
          }
        />
      )}

      {dialog.kind === 'move' ? (
        <MoveDialog
          paths={dialog.paths}
          presetDestination={null}
          onClose={(movedAny) => {
            setDialog({ kind: 'none' })
            setSelectedPaths(new Set())
            if (movedAny) setRefreshToken((t) => t + 1)
          }}
        />
      ) : null}
      {dialog.kind === 'trash' ? (
        <TrashConfirmDialog
          items={dialog.entries.map((e) => ({ path: e.path, size: e.size }))}
          onClose={(trashed) => {
            setDialog({ kind: 'none' })
            setSelectedPaths(new Set())
            if (trashed) setRefreshToken((t) => t + 1)
          }}
        />
      ) : null}
      {dialog.kind === 'organize' ? (
        <OrganizeDialog
          files={files}
          homePath={homePath}
          downloadsPath={downloadsPath}
          onClose={(movedAny) => {
            setDialog({ kind: 'none' })
            setSelectedPaths(new Set())
            if (movedAny) setRefreshToken((t) => t + 1)
          }}
        />
      ) : null}
    </div>
  )
}

function CategoryChip({
  label,
  count,
  active,
  onClick
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:bg-foreground/5'
      )}
    >
      {label}
      <span className={cn('rounded-full px-1.5 text-[11px]', active ? 'bg-primary/15' : 'bg-foreground/5')}>
        {count}
      </span>
    </button>
  )
}
