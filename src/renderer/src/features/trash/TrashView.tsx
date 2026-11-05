import { useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, Trash2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { FileTable } from '@/components/files/FileTable'
import type { TableMenuItem } from '@/components/files/FileTable'
import { GetInfoDialog } from '@/components/dialogs/GetInfoDialog'
import { EmptyState, PermissionNotice } from '@/components/common/EmptyState'
import { ToolbarLabel, ToolbarSpacer, ViewToolbar } from '@/components/common/ViewToolbar'
import { tidy, unwrap, messageOf, codeOf } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import { useMetaStore } from '@/stores/browser-store'
import type { DeleteItemResult, FileEntry } from '@shared/types/files'

type DialogState =
  | { kind: 'none' }
  | { kind: 'info'; path: string }
  | { kind: 'delete'; items: FileEntry[] }

/** The macOS Trash: review, restore, or permanently delete. */
export function TrashView() {
  const folderSizes = useMetaStore((s) => s.folderSizes)
  const setFolderSize = useMetaStore((s) => s.setFolderSize)

  const [entries, setEntries] = useState<FileEntry[]>([])
  const [exists, setExists] = useState(true)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(new Set())
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' })
  const [sizing, setSizing] = useState<{ done: number; total: number } | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    // Intentional fetch-on-mount flags.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    setPermissionDenied(false)
    void unwrap(tidy().listTrash())
      .then((listing) => {
        if (cancelled) return
        setEntries(listing.entries)
        setExists(listing.exists)
        setPermissionDenied(listing.permissionDenied ?? false)
        setLoading(false)
      })
      .catch((cause) => {
        if (cancelled) return
        setPermissionDenied(codeOf(cause) === 'PERMISSION_DENIED')
        setError(codeOf(cause) === 'PERMISSION_DENIED' ? null : messageOf(cause))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refreshToken])

  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.modifiedAt - a.modifiedAt),
    [entries]
  )

  const totalBytes = useMemo(
    () => sorted.reduce((sum, entry) => sum + (folderSizes.get(entry.path)?.bytes ?? entry.size), 0),
    [sorted, folderSizes]
  )

  // Only quote a total once every folder's size is known — otherwise the
  // number would silently exclude folders.
  const sizesComplete = useMemo(
    () => sorted.every((entry) => !entry.isDirectory || folderSizes.has(entry.path)),
    [sorted, folderSizes]
  )

  const openItem = (itemPath: string): void => {
    void unwrap(tidy().openPath(itemPath)).catch((cause) => toast.error(messageOf(cause)))
  }

  const previewItem = (itemPath: string): void => {
    void unwrap(tidy().previewFile(itemPath)).catch((cause) => toast.error(messageOf(cause)))
  }

  const restore = async (targets: FileEntry[]): Promise<void> => {
    try {
      const destination = await unwrap(tidy().pickFolder('Restore to'))
      if (!destination) return
      const results = await unwrap(
        tidy().moveItems(
          targets.map((target) => target.path),
          destination,
          'keep-both'
        )
      )
      const failed = results.filter((result) => result.status === 'failed')
      if (failed.length === 0) {
        toast.success(
          targets.length === 1 ? 'Restored' : `Restored ${targets.length} items`
        )
      } else {
        toast.error(
          `${results.length - failed.length} restored, ${failed.length} failed. First failure: ${failed[0].error?.message ?? 'unknown error'}`
        )
      }
      setSelectedPaths(new Set())
      setRefreshToken((token) => token + 1)
    } catch (cause) {
      toast.error(messageOf(cause))
    }
  }

  const calculateSizes = async (): Promise<void> => {
    const targets = sorted.filter((entry) => entry.isDirectory && !folderSizes.has(entry.path))
    if (targets.length === 0) return
    setSizing({ done: 0, total: targets.length })
    for (let index = 0; index < targets.length; index++) {
      try {
        const size = await unwrap(tidy().getFolderSize(targets[index].path))
        setFolderSize(targets[index].path, size)
      } catch {
        // Folder vanished or is unreadable — leave its size unknown.
      }
      setSizing({ done: index + 1, total: targets.length })
    }
    setSizing(null)
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
    { label: 'Open', onSelect: () => openItem(entry.path) },
    { label: 'Quick Look', onSelect: () => previewItem(entry.path) },
    { label: 'Get Info', onSelect: () => setDialog({ kind: 'info', path: entry.path }) },
    {
      label: 'Reveal in Trash',
      onSelect: () => void unwrap(tidy().revealInFinder(entry.path)).catch(() => {})
    },
    {
      label: 'Restore to…',
      separatorBefore: true,
      onSelect: () => void restore([entry])
    },
    {
      label: 'Delete Immediately',
      destructive: true,
      separatorBefore: true,
      onSelect: () => setDialog({ kind: 'delete', items: [entry] })
    }
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewToolbar>
        <ToolbarLabel>
          {permissionDenied
            ? 'Trash access blocked'
            : sizing
              ? `Calculating sizes... ${sizing.done}/${sizing.total}`
              : sorted.length === 0
                ? exists
                  ? 'Empty'
                  : 'Nothing has been trashed yet'
                : `${sorted.length} item${sorted.length === 1 ? '' : 's'}${sizesComplete ? ` · ${formatBytes(totalBytes)}` : ''}`}
        </ToolbarLabel>
        <ToolbarSpacer />
        {selectedPaths.size > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() =>
              void restore(sorted.filter((entry) => selectedPaths.has(entry.path)))
            }
          >
            <Undo2 className="size-3.5" />
            Restore selected ({selectedPaths.size})
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => void calculateSizes()}
          disabled={sizing !== null || sorted.length === 0}
        >
          <RefreshCw className="size-3.5" />
          Calculate sizes
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs text-destructive hover:text-destructive"
          onClick={() => setDialog({ kind: 'delete', items: sorted })}
          disabled={sorted.length === 0}
        >
          <Trash2 className="size-3.5" />
          Empty Trash
        </Button>
      </ViewToolbar>

      {permissionDenied ? (
        <PermissionNotice
          className="m-4"
          message="macOS blocked access to the Trash. Open System Settings → Privacy & Security → Full Disk Access, enable Tidy, then reopen the app."
        />
      ) : error ? (
        <p className="px-4 py-2 text-xs text-destructive">{error}</p>
      ) : null}

      {loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Checking the Trash...
        </div>
      ) : permissionDenied ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Button variant="outline" size="sm" onClick={() => setRefreshToken((token) => token + 1)}>
            <RefreshCw className="size-3.5" />
            Check again
          </Button>
        </div>
      ) : (
        <FileTable
          ariaLabel="Trash"
          entries={sorted}
          selectedPaths={selectedPaths}
          onRowClick={handleRowClick}
          onOpen={(entry) => openItem(entry.path)}
          onPreview={(entry) => previewItem(entry.path)}
          buildMenu={buildMenu}
          folderSizes={folderSizes}
          emptyState={
            <EmptyState
              icon={Trash2}
              title="Trash is empty"
              description="Items moved to the Trash from Tidy or Finder appear here, ready to restore or delete."
            />
          }
        />
      )}

      {dialog.kind === 'info' ? (
        <GetInfoDialog path={dialog.path} onClose={() => setDialog({ kind: 'none' })} />
      ) : null}
      {dialog.kind === 'delete' ? (
        <DeleteConfirmDialog
          items={dialog.items}
          onClose={(deleted) => {
            setDialog({ kind: 'none' })
            if (deleted) {
              setSelectedPaths(new Set())
              setRefreshToken((token) => token + 1)
            }
          }}
        />
      ) : null}
    </div>
  )
}

/** Confirmation for irreversible deletion — deliberately explicit. */
function DeleteConfirmDialog({
  items,
  onClose
}: {
  items: FileEntry[]
  onClose: (deleted: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const totalBytes = items.reduce((sum, item) => sum + item.size, 0)
  // Folders report 0 bytes until sized, so only quote a total for plain files.
  const canQuoteSize = totalBytes > 0 && items.every((item) => !item.isDirectory)
  const title =
    items.length === 1
      ? `Delete “${items[0].name}” permanently?`
      : `Delete ${items.length} items permanently?`

  const confirm = async (): Promise<void> => {
    setBusy(true)
    try {
      const results = await unwrap(tidy().deletePermanently(items.map((item) => item.path)))
      const failed = results.filter((result: DeleteItemResult) => result.status === 'failed')
      if (failed.length === 0) {
        toast.success(
          items.length === 1 ? 'Deleted permanently' : `Deleted ${items.length} items permanently`
        )
      } else {
        toast.error(
          `${results.length - failed.length} deleted, ${failed.length} failed. First failure: ${failed[0].error?.message ?? 'unknown error'}`
        )
      }
      onClose(failed.length < results.length)
    } catch (error) {
      toast.error(messageOf(error))
      onClose(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            This bypasses the Trash and cannot be undone.
            {canQuoteSize ? ` Total size: ${formatBytes(totalBytes)}.` : ''}
          </DialogDescription>
        </DialogHeader>
        {items.length > 1 ? (
          <ul className="max-h-40 overflow-y-auto rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {items.slice(0, 8).map((item) => (
              <li key={item.path} className="truncate py-0.5">
                {item.name}
              </li>
            ))}
            {items.length > 8 ? <li className="py-0.5">...and {items.length - 8} more</li> : null}
          </ul>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onClose(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Deleting...' : 'Delete Permanently'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}