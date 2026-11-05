import { useEffect, useMemo, useRef, useState } from 'react'
import { squarify } from '@/lib/treemap'
import type { TreemapItem } from '@/lib/treemap'
import { FolderOpen } from 'lucide-react'
import { formatBytes } from '@/lib/format'
import { cn } from 'cn'

const PALETTE = [
  'oklch(0.55 0.1 220)',
  'oklch(0.6 0.1 190)',
  'oklch(0.55 0.11 260)',
  'oklch(0.62 0.1 150)',
  'oklch(0.58 0.1 300)',
  'oklch(0.6 0.11 30)',
  'oklch(0.55 0.09 60)',
  'oklch(0.6 0.08 350)'
]

/**
 * Interactive disk treemap (#11). Click a rectangle to descend into that
 * folder; the breadcrumb above pops back out. Sizes come from the caller.
 */
export function DiskTreemap({
  root,
  items,
  loading,
  onDrill,
  onRefresh
}: {
  root: string
  items: TreemapItem[]
  loading: boolean
  onDrill: (path: string) => void
  onRefresh: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 420 })

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      setSize({ w: element.clientWidth, h: Math.max(element.clientHeight, 240) })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const laid = useMemo(() => squarify(items, size.w, size.h), [items, size])
  const crumbs = useMemo(() => {
    const parts = root.split('/').filter(Boolean)
    return parts.slice(-3)
  }, [root])

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="truncate" title={root}>
          {crumbs.length > 0 ? `${crumbs.join(' / ')}` : root}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded px-1.5 py-0.5 hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
        >
          rescan
        </button>
        {loading ? <span>measuring…</span> : null}
      </div>
      <div ref={containerRef} className="relative h-[420px] w-full overflow-hidden rounded-md border border-border bg-muted/30">
        {laid.map((item) => (
          <button
            key={item.path}
            type="button"
            title={`${item.name} — ${formatBytes(item.bytes)}`}
            onClick={() => item.bytes > 0 && onDrill(item.path)}
            style={{
              position: 'absolute',
              left: item.x + 1,
              top: item.y + 1,
              width: Math.max(item.w - 2, 0),
              height: Math.max(item.h - 2, 0),
              backgroundColor: PALETTE[item.name.charCodeAt(0) % PALETTE.length],
              opacity: 0.85
            }}
            className={cn(
              'group flex flex-col items-start justify-between overflow-hidden rounded-[3px] p-1.5 text-left text-white hover:opacity-100 focus-visible:ring-2 focus-visible:ring-white/70'
            )}
          >
            <span className="w-full truncate text-[11px] font-medium drop-shadow">{item.name}</span>
            <span className="w-full truncate text-[11px] opacity-90">{formatBytes(item.bytes)}</span>
          </button>
        ))}
        {items.length === 0 && !loading ? (
          <p className="flex h-full items-center justify-center text-xs text-muted-foreground">Nothing to map here.</p>
        ) : null}
      </div>
      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <FolderOpen className="size-3" />
        Click a block to descend into that folder.
      </p>
    </div>
  )
}

