import { Fragment, useState } from 'react'
import { House, ChevronRight } from 'lucide-react'
import { cn } from 'cn'

interface BreadcrumbsProps {
  path: string
  onNavigate: (path: string) => void
  /** When provided, ancestor crumbs accept dragged rows as move targets. */
  onDropOnFolder?: (targetDir: string) => void
}

interface Segment {
  name: string
  path: string
}

function segmentsOf(path: string): Segment[] {
  const parts = path.split('/').filter(Boolean)
  const segments: Segment[] = []
  let acc = ''
  for (const part of parts) {
    acc += '/' + part
    segments.push({ name: part, path: acc })
  }
  return segments
}

export function Breadcrumbs({ path, onNavigate, onDropOnFolder }: BreadcrumbsProps) {
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const segments = segmentsOf(path)

  const dropEnabled = Boolean(onDropOnFolder)

  const segmentProps = (segment: Segment | null, target: string) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!dropEnabled || !segment) return
      if (![...event.dataTransfer.types].includes('application/x-tidy')) return
      event.preventDefault()
      setDropTarget(target)
    },
    onDragLeave: () => setDropTarget((current) => (current === target ? null : current)),
    onDrop: (event: React.DragEvent) => {
      setDropTarget(null)
      if (!dropEnabled || !segment) return
      if (![...event.dataTransfer.types].includes('application/x-tidy')) return
      event.preventDefault()
      onDropOnFolder?.(segment.path)
    }
  })

  return (
    <nav
      aria-label="Folder path"
      className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-[13px]"
    >
      {/* Root */}
      <button
        type="button"
        onClick={() => onNavigate('/')}
        aria-label="Root of the disk"
        {...segmentProps(segments[0] ?? null, '/')}
        className={cn(
          'flex items-center rounded px-1.5 py-0.5 hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring',
          dropTarget === '/' && 'bg-primary/15 ring-1 ring-inset ring-primary/40'
        )}
      >
        <House className="size-3.5 text-muted-foreground" />
      </button>
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1
        return (
          <Fragment key={segment.path}>
            <ChevronRight className="size-3 shrink-0 text-muted-foreground/50" />
            <button
              type="button"
              onClick={() => !isLast && onNavigate(segment.path)}
              aria-current={isLast ? 'location' : undefined}
              disabled={isLast}
              {...segmentProps(segment, segment.path)}
              className={cn(
                'max-w-52 truncate rounded px-1.5 py-0.5 focus-visible:ring-2 focus-visible:ring-ring',
                isLast
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                dropTarget === segment.path && 'bg-primary/15 ring-1 ring-inset ring-primary/40'
              )}
              title={segment.path}
            >
              {segment.name}
            </button>
          </Fragment>
        )
      })}
    </nav>
  )
}
