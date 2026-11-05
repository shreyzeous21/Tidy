import { useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, Link2 } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { FileIcon } from '@/components/common/FileIcon'
import { formatBytes, formatDate } from '@/lib/format'
import { kindLabel } from '@shared/constants/categories'
import type { FileEntry, SortDirection, SortKey } from '@shared/types/files'
import { cn } from 'cn'

export interface TableMenuItem {
  label: string
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
  separatorBefore?: boolean
}

interface FileTableProps {
  entries: FileEntry[]
  selectedPaths: ReadonlySet<string>
  onRowClick?: (entry: FileEntry, index: number, event: { metaKey: boolean; shiftKey: boolean }) => void
  onOpen: (entry: FileEntry) => void
  buildMenu?: (entry: FileEntry) => TableMenuItem[]
  sort?: { key: SortKey; direction: SortDirection }
  onSortChange?: (key: SortKey) => void
  /** Show the containing folder instead of the kind (search / cleanup results). */
  showPath?: boolean
  emptyState?: React.ReactNode
  /** When provided, folders accept dragged rows (move) and rows are draggable. */
  getDragPaths?: () => string[] | null
  onDropOnFolder?: (targetDir: string) => void
  /** Native Quick Look (Space) on the first selected file. */
  onPreview?: (entry: FileEntry) => void
  /** Calculated recursive folder sizes, shown in the Size column. */
  folderSizes?: Map<string, { bytes: number; files: number; truncated: boolean }>
  /** Extra key handling on the focusable row container (⌘A, ⌘⌫, ⌘↑…). */
  onKeyDown?: (event: React.KeyboardEvent) => void
  className?: string
  ariaLabel?: string
}

const ROW_HEIGHT = 34

const COLUMNS_WITH_KIND: Array<{ key: SortKey | null; label: string; className: string }> = [
  { key: 'name', label: 'Name', className: 'pl-3' },
  { key: 'kind', label: 'Kind', className: 'w-32' },
  { key: 'size', label: 'Size', className: 'w-20 text-right' },
  { key: 'modifiedAt', label: 'Modified', className: 'w-36 pr-3 text-right' }
]

const COLUMNS_WITH_PATH: Array<{ key: SortKey | null; label: string; className: string }> = [
  { key: 'name', label: 'Name', className: 'pl-3' },
  { key: null, label: 'Location', className: 'w-64' },
  { key: 'size', label: 'Size', className: 'w-20 text-right' },
  { key: 'modifiedAt', label: 'Modified', className: 'w-36 pr-3 text-right' }
]

export function FileTable({
  entries,
  selectedPaths,
  onRowClick,
  onOpen,
  buildMenu,
  sort,
  onSortChange,
  showPath = false,
  emptyState,
  getDragPaths,
  onDropOnFolder,
  onPreview,
  folderSizes,
  onKeyDown,
  className,
  ariaLabel
}: FileTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [dragOverDir, setDragOverDir] = useState<string | null>(null)

  // TanStack Virtual returns imperative handles that React Compiler cannot
  // memoize; the table is intentionally outside the compiler's memoization.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16
  })

  const columns = showPath ? COLUMNS_WITH_PATH : COLUMNS_WITH_KIND

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (event.key === 'Enter') {
      const firstSelected = entries.find((entry) => selectedPaths.has(entry.path))
      if (firstSelected) {
        event.preventDefault()
        onOpen(firstSelected)
      }
      return
    }
    // Space = native Quick Look on the first selected file.
    if (event.key === ' ' && onPreview && !event.metaKey && !event.shiftKey) {
      const firstSelected = entries.find((entry) => selectedPaths.has(entry.path) && !entry.isDirectory)
      if (firstSelected) {
        event.preventDefault()
        onPreview(firstSelected)
      }
    }
  }

  const dragPayload = (entry: FileEntry): string[] | null => {
    if (!getDragPaths) return null
    const paths = getDragPaths()
    if (!paths || paths.length === 0) return null
    return selectedPaths.has(entry.path) ? paths : [entry.path]
  }

  const canAcceptDrop = (entry: FileEntry): boolean => {
    if (!entry.isDirectory || !onDropOnFolder) return false
    const paths = getDragPaths?.() ?? null
    if (!paths || paths.length === 0) return false
    // Never drop a folder into itself or its own descendants.
    return paths.every((p) => p !== entry.path && !p.startsWith(entry.path + '/'))
  }

  if (entries.length === 0 && emptyState) {
    return <div className={cn('min-h-0 flex-1 overflow-hidden', className)}>{emptyState}</div>
  }

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      {/* Header */}
      <div className="flex h-8 shrink-0 items-center border-b border-border bg-muted/40 text-[11px] font-medium text-muted-foreground">
        {columns.map((col) => {
          const isActive = col.key !== null && sort?.key === col.key
          const Arrow = isActive && sort.direction === 'desc' ? ArrowDown : ArrowUp
          return (
            <div key={col.label} className={cn('flex items-center', col.className)} aria-sort={isActive ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
              {col.key && onSortChange ? (
                <button
                  type="button"
                  onClick={() => onSortChange(col.key as SortKey)}
                  className={cn(
                    'flex items-center gap-1 px-1 py-0.5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                    isActive && 'text-foreground'
                  )}
                >
                  {col.label}
                  {isActive ? <Arrow className="size-3" /> : null}
                </button>
              ) : (
                <span className="px-1">{col.label}</span>
              )}
            </div>
          )
        })}
      </div>

      {/* Rows (virtualized) */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto outline-none"
        aria-label={ariaLabel}
        role="listbox"
        aria-multiselectable="true"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const entry = entries[virtualRow.index]
            const selected = selectedPaths.has(entry.path)
            const droppable = canAcceptDrop(entry)
            const row = (
              <div
                data-index={virtualRow.index}
                className={cn(
                  'flex h-[34px] items-center border-b border-border/40 text-[13px] outline-none transition-colors',
                  selected ? 'bg-primary/10' : 'hover:bg-foreground/[0.035]',
                  dragOverDir === entry.path && 'bg-primary/15 ring-1 ring-inset ring-primary/40',
                  entry.isSymlink && 'opacity-70'
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2 pl-3">
                  <FileIcon kind={entry.kind} />
                  <span className="truncate" title={entry.name}>
                    {entry.name}
                  </span>
                  {entry.isSymlink ? <Link2 className="size-3 shrink-0 text-muted-foreground/60" /> : null}
                </div>
                {showPath ? (
                  <div className="w-64 min-w-0 px-2 text-xs text-muted-foreground">
                    <span className="block truncate" title={entry.path}>
                      {dirOf(entry.path)}
                    </span>
                  </div>
                ) : (
                  <div className="w-32 px-2 text-xs text-muted-foreground">{kindLabel(entry)}</div>
                )}
                <div className="w-20 px-2 text-right text-xs tabular-nums text-muted-foreground">
                  {entry.isDirectory
                    ? folderSizes?.has(entry.path)
                      ? formatBytes(folderSizes.get(entry.path)!.bytes)
                      : '—'
                    : formatBytes(entry.size)}
                </div>
                <div className="w-36 truncate pr-3 text-right text-xs tabular-nums text-muted-foreground">
                  {formatDate(entry.modifiedAt)}
                </div>
              </div>
            )

            const interactive = onRowClick || buildMenu
            const rowElement = interactive ? (
              <div
                role="option"
                aria-selected={selected}
                onClick={(event) =>
                  onRowClick?.(entry, virtualRow.index, {
                    metaKey: event.metaKey,
                    shiftKey: event.shiftKey
                  })
                }
                onDoubleClick={() => onOpen(entry)}
                draggable={Boolean(getDragPaths)}
                onDragStart={(event) => {
                  const paths = dragPayload(entry)
                  if (!paths) {
                    event.preventDefault()
                    return
                  }
                  event.dataTransfer.setData('application/x-tidy', JSON.stringify(paths))
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(event) => {
                  if (droppable && [...event.dataTransfer.types].includes('application/x-tidy')) {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    setDragOverDir(entry.path)
                  }
                }}
                onDragLeave={() => setDragOverDir((current) => (current === entry.path ? null : current))}
                onDrop={(event) => {
                  setDragOverDir(null)
                  if (!droppable) return
                  if (![...event.dataTransfer.types].includes('application/x-tidy')) return
                  event.preventDefault()
                  onDropOnFolder?.(entry.path)
                }}
                className="cursor-default"
              >
                {row}
              </div>
            ) : (
              row
            )

            const menu = buildMenu?.(entry)
            if (!menu || menu.length === 0) {
              return (
                <div
                  key={entry.path}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                >
                  {rowElement}
                </div>
              )
            }

            return (
              <div
                key={entry.path}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`
                }}
              >
                <ContextMenu>
                  <ContextMenuTrigger asChild>{rowElement}</ContextMenuTrigger>
                  <ContextMenuContent>
                    {menu.map((item, index) => (
                      <Fragmented key={`${item.label}-${index}`} item={item} />
                    ))}
                  </ContextMenuContent>
                </ContextMenu>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Fragmented({ item }: { item: TableMenuItem }) {
  return (
    <>
      {item.separatorBefore ? <ContextMenuSeparator /> : null}
      <ContextMenuItem
        disabled={item.disabled}
        onSelect={item.onSelect}
        className={item.destructive ? 'text-destructive focus:text-destructive' : undefined}
      >
        {item.label}
      </ContextMenuItem>
    </>
  )
}

function dirOf(p: string): string {
  const idx = p.lastIndexOf('/')
  return idx <= 0 ? '/' : p.slice(0, idx)
}
