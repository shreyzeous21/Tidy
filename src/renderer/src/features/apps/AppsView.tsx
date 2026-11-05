import { useEffect, useMemo, useState } from 'react'
import { LayoutGrid, Loader2, RefreshCw, Search as SearchIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { FileTable } from '@/components/files/FileTable'
import type { TableMenuItem } from '@/components/files/FileTable'
import { GetInfoDialog } from '@/components/dialogs/GetInfoDialog'
import { ViewerDialog } from '@/components/dialogs/ViewerDialog'
import { LoginAgentsDialog, LeftoversDialog } from '@/components/dialogs/ToolDialogs'
import { TrashConfirmDialog } from '@/components/dialogs/TrashConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { ToolbarLabel, ToolbarSpacer, ViewToolbar } from '@/components/common/ViewToolbar'
import { tidy, unwrap, messageOf } from '@/lib/api'
import { useMetaStore } from '@/stores/browser-store'
import type { ApplicationEntry } from '@shared/types/info'
import type { FileEntry } from '@shared/types/files'

type DialogState =
  | { kind: 'none' }
  | { kind: 'info'; path: string }
  | { kind: 'view'; path: string }
  | { kind: 'trash'; items: Array<{ path: string; size: number }> }
  | { kind: 'extras' }
  | { kind: 'leftovers' }

/** Pseudo-entry so the shared FileTable can render applications. */
function toFileEntry(app: ApplicationEntry): FileEntry {
  return {
    name: app.name,
    path: app.path,
    isDirectory: true,
    isSymlink: false,
    size: app.sizeBytes ?? 0,
    modifiedAt: 0,
    kind: 'installer',
    extension: 'app'
  }
}

/** Full application list viewer: /Applications + ~/Applications. */
export function AppsView() {
  const folderSizes = useMetaStore((s) => s.folderSizes)
  const setFolderSize = useMetaStore((s) => s.setFolderSize)

  const [apps, setApps] = useState<ApplicationEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [sizing, setSizing] = useState<{ done: number; total: number } | null>(null)
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(new Set())
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' })
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    // Intentional fetch-on-mount flags.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    void unwrap(tidy().listApplications())
      .then((list) => {
        if (cancelled) return
        setApps(list)
        setLoading(false)
      })
      .catch((cause) => {
        if (cancelled) return
        setError(messageOf(cause))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refreshToken])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? apps.filter((app) => app.name.toLowerCase().includes(q)) : apps
  }, [apps, filter])

  const calculateSizes = async (): Promise<void> => {
    setSizing({ done: 0, total: visible.length })
    for (let index = 0; index < visible.length; index++) {
      const app = visible[index]
      if (folderSizes.has(app.path)) continue
      try {
        const size = await unwrap(tidy().getFolderSize(app.path))
        setFolderSize(app.path, size)
      } catch {
        // unreadable app bundle — leave size unknown
      }
      setSizing({ done: index + 1, total: visible.length })
    }
    setSizing(null)
  }

  const openApp = (appPath: string): void => {
    void unwrap(tidy().openPath(appPath)).catch((cause) => toast.error(messageOf(cause)))
  }

  const previewApp = (appPath: string): void => {
    void unwrap(tidy().previewFile(appPath)).catch((cause) => toast.error(messageOf(cause)))
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

  const buildMenu = (entry: FileEntry): TableMenuItem[] => [
    { label: 'Open', onSelect: () => openApp(entry.path) },
    { label: 'Quick Look', onSelect: () => previewApp(entry.path) },
    { label: 'Get Info', onSelect: () => setDialog({ kind: 'info', path: entry.path }) },
    { label: 'Reveal in Finder', onSelect: () => void unwrap(tidy().revealInFinder(entry.path)).catch(() => {}) },
    {
      label: 'Calculate Size',
      disabled: folderSizes.has(entry.path),
      onSelect: () => {
        void unwrap(tidy().getFolderSize(entry.path))
          .then((size) => setFolderSize(entry.path, size))
          .catch((cause) => toast.error(messageOf(cause)))
      }
    },
    {
      label: 'Move to Trash',
      destructive: true,
      separatorBefore: true,
      onSelect: () => {
        const size = folderSizes.get(entry.path)?.bytes ?? 0
        setDialog({ kind: 'trash', items: [{ path: entry.path, size }] })
      }
    }
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewToolbar>
        <div className="relative w-64">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter apps"
            className="h-8 pl-8 text-xs"
            aria-label="Filter applications"
          />
        </div>
        <ToolbarLabel>
          {visible.length} app{visible.length === 1 ? '' : 's'}
        </ToolbarLabel>
        <ToolbarSpacer />
        {sizing ? (
          <span className="text-xs text-muted-foreground">
            Calculating sizes… {sizing.done}/{sizing.total}
          </span>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => void calculateSizes()}>
                <RefreshCw className="size-3.5" />
                Calculate sizes
              </Button>
            </TooltipTrigger>
            <TooltipContent>Walks each app bundle to measure disk usage</TooltipContent>
          </Tooltip>
        )}
      </ViewToolbar>

      {error ? <p className="px-4 py-2 text-xs text-destructive">{error}</p> : null}

      {loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Listing applications…
        </div>
      ) : (
        <FileTable
          ariaLabel="Installed applications"
          entries={visible.map(toFileEntry)}
          selectedPaths={selectedPaths}
          onRowClick={handleRowClick}
          onOpen={(entry) => openApp(entry.path)}
          buildMenu={buildMenu}
          folderSizes={folderSizes}
          emptyState={
            <EmptyState
              icon={LayoutGrid}
              title={filter ? 'No apps match' : 'No applications found'}
              description={filter ? 'Try a different name.' : 'Apps in /Applications and ~/Applications appear here.'}
            />
          }
        />
      )}

      {dialog.kind === 'info' ? <GetInfoDialog path={dialog.path} onClose={() => setDialog({ kind: 'none' })} /> : null}
      {dialog.kind === 'extras' ? <LoginAgentsDialog onClose={() => setDialog({ kind: 'none' })} /> : null}
      {dialog.kind === 'leftovers' ? (
        <LeftoversDialog
          onClose={() => setDialog({ kind: 'none' })}
          onTrash={(paths) => {
            void unwrap(tidy().moveToTrash(paths))
              .then((results) => {
                const failed = results.filter((r) => r.status === 'failed')
                if (failed.length > 0) toast.error(`${failed.length} item(s) could not be trashed.`)
                else toast.success('Leftovers moved to Trash')
              })
              .catch((cause) => toast.error(messageOf(cause)))
          }}
        />
      ) : null}
      {dialog.kind === 'view' ? <ViewerDialog path={dialog.path} onClose={() => setDialog({ kind: 'none' })} /> : null}
      {dialog.kind === 'trash' ? (
        <TrashConfirmDialog
          items={dialog.items}
          onClose={(trashed) => {
            setDialog({ kind: 'none' })
            setSelectedPaths(new Set())
            if (trashed) setRefreshToken((t) => t + 1)
          }}
        />
      ) : null}
    </div>
  )
}
