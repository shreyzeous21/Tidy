import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { FileIcon } from '@/components/common/FileIcon'
import { tidy, unwrap } from '@/lib/api'
import { formatBytes, formatDate, shortenHome } from '@/lib/format'
import { kindLabel } from '@shared/constants/categories'
import { useMetaStore } from '@/stores/browser-store'
import type { ItemInfo } from '@shared/types/info'

interface GetInfoDialogProps {
  path: string
  onClose: () => void
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all text-right text-xs font-medium">{children}</span>
    </div>
  )
}

/** Get Info panel: rich metadata for one item (⌘I / context menu). */
export function GetInfoDialog({ path, onClose }: GetInfoDialogProps) {
  const homePath = useMetaStore((s) => s.homePath)
  const [info, setInfo] = useState<ItemInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void unwrap(tidy().getItemInfo(path))
      .then((result) => !cancelled && setInfo(result))
      .catch((cause) => !cancelled && setError(cause instanceof Error ? cause.message : 'Could not read info.'))
    return () => {
      cancelled = true
    }
  }, [path])

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileIcon kind={info?.kind ?? 'other'} />
            <span className="truncate">{info?.name ?? path.split('/').pop()}</span>
          </DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : !info ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Reading info…</p>
        ) : (
          <div className="divide-y divide-border/60">
            <Row label="Kind">{kindLabel({ isDirectory: info.isDirectory, name: info.name })}{info.isSymlink ? ' (symlink)' : ''}</Row>
            <Row label="Where">{shortenHome(path.slice(0, path.lastIndexOf('/')) || '/', homePath)}</Row>
            {info.isSymlink && info.symlinkTarget ? <Row label="Target">{info.symlinkTarget}</Row> : null}
            <Row label="Size">{info.isDirectory ? '—' : formatBytes(info.size)}</Row>
            <Row label="Created">{formatDate(info.createdAt)}</Row>
            <Row label="Modified">{formatDate(info.modifiedAt)}</Row>
            <Row label="Last accessed">{formatDate(info.accessedAt)}</Row>
            <Row label="Permissions">
              <span className="font-mono">
                {info.permissionsRwx} ({info.permissionsOctal})
              </span>
            </Row>
            <Row label="Owner">{info.ownerIsYou ? 'You' : `uid ${info.ownerUid}`}</Row>
            {info.hidden ? <Row label="Visibility">Hidden (dotfile)</Row> : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
