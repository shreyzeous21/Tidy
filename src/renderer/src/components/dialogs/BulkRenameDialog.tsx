import { useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CircleAlert, Check, CircleMinus } from 'lucide-react'
import { toast } from 'sonner'
import { tidy, unwrap } from '@/lib/api'
import { planBulkRename } from '@/lib/bulk-rename'
import type { BulkRenameOptions, RenameMode } from '@/lib/bulk-rename'
import type { FileEntry } from '@shared/types/files'
import { cn } from 'cn'

interface BulkRenameDialogProps {
  entries: FileEntry[]
  /** All names currently in the folder (for collision detection). */
  existingNames: string[]
  onClose: (renamed: boolean) => void
}

const MODES: Array<{ value: RenameMode; label: string }> = [
  { value: 'replace', label: 'Find & replace' },
  { value: 'prefix', label: 'Add prefix' },
  { value: 'suffix', label: 'Add suffix' },
  { value: 'number', label: 'Sequential number' },
  { value: 'extension', label: 'Change extension' }
]

export function BulkRenameDialog({ entries, existingNames, onClose }: BulkRenameDialogProps) {
  const [mode, setMode] = useState<RenameMode>('replace')
  const [find, setFind] = useState('')
  const [replaceWith, setReplaceWith] = useState('')
  const [prefix, setPrefix] = useState('')
  const [suffix, setSuffix] = useState(' - final')
  const [startNumber, setStartNumber] = useState('1')
  const [pad, setPad] = useState('2')
  const [newExtension, setNewExtension] = useState('')
  const [busy, setBusy] = useState(false)
  const [failures, setFailures] = useState<Array<{ name: string; message: string }>>([])

  const options: BulkRenameOptions = {
    mode,
    find,
    replaceWith,
    prefix,
    suffix,
    startNumber: Math.max(0, Number(startNumber) || 0),
    pad: Math.min(Math.max(Number(pad) || 1, 1), 6),
    newExtension
  }

  const rows = useMemo(
    () => planBulkRename(entries, existingNames, options),
    // options object identity changes per keystroke — that's the point (live preview).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, existingNames, mode, find, replaceWith, prefix, suffix, startNumber, pad, newExtension]
  )

  const renamable = rows.filter((row) => row.status === 'ok')
  const collisions = rows.filter((row) => row.status === 'collision')

  const apply = async (): Promise<void> => {
    setBusy(true)
    setFailures([])
    const failed: Array<{ name: string; message: string }> = []
    let renamed = 0
    for (const row of renamable) {
      try {
        await unwrap(tidy().renameItem(row.entry.path, row.newName, false))
        renamed++
      } catch (error) {
        failed.push({
          name: row.entry.name,
          message: error instanceof Error ? error.message : 'Rename failed.'
        })
      }
    }
    setBusy(false)
    if (renamed > 0) toast.success(renamed === 1 ? 'Renamed 1 item' : `Renamed ${renamed} items`)
    if (failed.length > 0) {
      setFailures(failed)
      toast.error(`${failed.length} rename(s) failed`)
      return
    }
    onClose(renamed > 0)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Bulk rename {entries.length} items</DialogTitle>
          <DialogDescription>Preview every change before applying. Conflicts are skipped, never overwritten.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={mode} onValueChange={(v) => setMode(v as RenameMode)}>
            <SelectTrigger size="sm" className="w-44" aria-label="Rename mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {mode === 'replace' ? (
            <>
              <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find" className="h-8 w-32" aria-label="Find text" />
              <span className="text-xs text-muted-foreground">→</span>
              <Input value={replaceWith} onChange={(e) => setReplaceWith(e.target.value)} placeholder="Replace with" className="h-8 w-32" aria-label="Replace with" />
            </>
          ) : null}
          {mode === 'prefix' ? (
            <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="Prefix" className="h-8 w-40" aria-label="Prefix" />
          ) : null}
          {mode === 'suffix' ? (
            <Input value={suffix} onChange={(e) => setSuffix(e.target.value)} placeholder="Suffix (before extension)" className="h-8 w-52" aria-label="Suffix" />
          ) : null}
          {mode === 'number' ? (
            <>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                Start
                <Input value={startNumber} onChange={(e) => setStartNumber(e.target.value.replace(/\D/g, ''))} className="h-8 w-16" inputMode="numeric" aria-label="Start number" />
              </label>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                Pad
                <Input value={pad} onChange={(e) => setPad(e.target.value.replace(/\D/g, ''))} className="h-8 w-14" inputMode="numeric" aria-label="Zero padding" />
              </label>
            </>
          ) : null}
          {mode === 'extension' ? (
            <Input value={newExtension} onChange={(e) => setNewExtension(e.target.value.replace(/[^\w]/g, ''))} placeholder="new ext (no dot)" className="h-8 w-40" aria-label="New extension" />
          ) : null}
        </div>

        <div className="max-h-64 overflow-y-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <tbody>
              {rows.map((row) => (
                <tr key={row.entry.path} className="border-b border-border/40 last:border-b-0">
                  <td className="max-w-44 truncate px-2.5 py-1.5 text-muted-foreground">{row.entry.name}</td>
                  <td className="w-6 px-1 text-center text-muted-foreground/60">→</td>
                  <td className={cn('max-w-44 truncate px-2.5 py-1.5 font-medium', row.status === 'collision' && 'text-destructive', row.status === 'unchanged' && 'text-muted-foreground/60 font-normal')}>
                    {row.newName}
                  </td>
                  <td className="w-24 px-2 py-1.5 text-right">
                    {row.status === 'ok' ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><Check className="size-3" /></span>
                    ) : row.status === 'unchanged' ? (
                      <span className="inline-flex items-center gap-1 text-muted-foreground/50"><CircleMinus className="size-3" /></span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-destructive" title={row.reason}><CircleAlert className="size-3" /></span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {collisions.length > 0 ? (
          <p className="text-[11px] text-muted-foreground">
            {collisions.length} conflict{collisions.length === 1 ? '' : 's'} will be skipped.
          </p>
        ) : null}
        {failures.length > 0 ? (
          <ul className="max-h-24 space-y-1 overflow-y-auto rounded-md border border-border bg-muted/40 p-2 text-xs">
            {failures.slice(0, 5).map((f) => (
              <li key={f.name} className="truncate text-destructive">{f.name} — {f.message}</li>
            ))}
          </ul>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onClose(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void apply()} disabled={busy || renamable.length === 0}>
            {busy ? 'Renaming…' : `Rename ${renamable.length} item${renamable.length === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
