import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { FileIcon } from '@/components/common/FileIcon'
import { toast } from 'sonner'
import { Binary, ExternalLink } from 'lucide-react'
import { tidy, unwrap } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import type { ReadTextResult } from '@shared/types/cleanup'

interface ViewerDialogProps {
  path: string
  onClose: () => void
}

/** Line-numbered gutter for the text viewer. */
function LineNumbers({ lines }: { lines: number }) {
  return (
    <div aria-hidden className="select-none border-r border-border/60 px-2.5 py-3 text-right font-mono text-[11px] leading-[1.55] text-muted-foreground/50">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i}>{i + 1}</div>
      ))}
    </div>
  )
}

/**
 * In-app file content viewer: shows the full text of a file (capped at
 * 512 KB, honestly flagged) with line numbers. Binary files get a clear
 * explanation plus the escape hatches instead of mojibake.
 */
export function ViewerDialog({ path, onClose }: ViewerDialogProps) {
  const [result, setResult] = useState<ReadTextResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void unwrap(tidy().readTextFile(path))
      .then((r) => !cancelled && setResult(r))
      .catch((cause) => !cancelled && setError(cause instanceof Error ? cause.message : 'Could not read the file.'))
    return () => {
      cancelled = true
    }
  }, [path])

  const name = path.split('/').pop() ?? path
  const lineCount = result && !result.binary ? result.content.split('\n').length : 0

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-2">
            <FileIcon kind="code" />
            <span className="truncate">{name}</span>
            {result ? (
              <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
                {formatBytes(result.size)}
                {result.truncated ? ' · showing first 512 KB' : ''}
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        {error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : !result ? (
          <p className="py-10 text-center text-xs text-muted-foreground">Reading…</p>
        ) : result.binary ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Binary className="size-8 text-muted-foreground/60" strokeWidth={1.5} />
            <div>
              <p className="text-sm font-medium">This looks like a binary file</p>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                Tidy doesn’t render binary content. Open it with its default app or take a look in Finder.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void unwrap(tidy().openPath(path)).catch((cause) => toast.error(cause instanceof Error ? cause.message : 'Open failed.'))}
              >
                <ExternalLink className="size-3.5" /> Open with default app
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void unwrap(tidy().revealInFinder(path)).catch(() => {})}>
                Reveal in Finder
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-muted/30">
            <div className="min-h-0 overflow-hidden">
              <LineNumbers lines={lineCount} />
            </div>
            <pre className="min-h-0 flex-1 overflow-auto px-3 py-3 font-mono text-[11.5px] leading-[1.55] whitespace-pre">
              {result.content}
            </pre>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
