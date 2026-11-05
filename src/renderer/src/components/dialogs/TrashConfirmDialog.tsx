import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { tidy, unwrap } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import type { TrashItemResult } from '@shared/types/files'

interface TrashConfirmDialogProps {
  items: Array<{ path: string; size: number }>
  onClose: (trashed: boolean) => void
}

/** Explicit confirmation before anything lands in the macOS Trash. */
export function TrashConfirmDialog({ items, onClose }: TrashConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const totalBytes = items.reduce((sum, item) => sum + item.size, 0)
  const title =
    items.length === 1
      ? `Move “${items[0].path.split('/').pop()}” to Trash?`
      : `Move ${items.length} items to Trash?`

  const confirm = async (): Promise<void> => {
    setBusy(true)
    try {
      const results = await unwrap(tidy().moveToTrash(items.map((i) => i.path)))
      const failed = results.filter((r: TrashItemResult) => r.status === 'failed')
      if (failed.length === 0) {
        toast.success(
          items.length === 1 ? 'Moved to Trash' : `Moved ${items.length} items to Trash`
        )
      } else {
        toast.error(
          `${results.length - failed.length} moved, ${failed.length} failed. First failure: ${failed[0].error?.message ?? 'unknown error'}`
        )
      }
      onClose(failed.length < results.length)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not move to Trash.')
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
            Items go to macOS Trash and can be restored from Finder.
            {totalBytes > 0 ? ` Total size: ${formatBytes(totalBytes)}.` : ''}
          </DialogDescription>
        </DialogHeader>
        {items.length > 1 ? (
          <ul className="max-h-40 overflow-y-auto rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {items.slice(0, 8).map((item) => (
              <li key={item.path} className="truncate py-0.5">
                {item.path.split('/').pop()}
              </li>
            ))}
            {items.length > 8 ? <li className="py-0.5">…and {items.length - 8} more</li> : null}
          </ul>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onClose(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Moving…' : 'Move to Trash'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
