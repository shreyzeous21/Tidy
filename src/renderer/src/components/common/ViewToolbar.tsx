import { cn } from 'cn'

/**
 * Shared header row used by every view. One height, one padding, one border —
 * so headers line up exactly across tabs instead of drifting per view.
 *
 * Layout convention: optional leading status/label, a spacer, then right-aligned
 * controls. Keep buttons `size="sm"` + `gap-1.5 text-xs` and icon buttons
 * `size="icon-sm"` so every toolbar reads the same.
 */
export function ViewToolbar({
  children,
  className,
  role,
  'aria-label': ariaLabel
}: {
  children: React.ReactNode
  className?: string
  role?: React.AriaRole
  'aria-label'?: string
}) {
  return (
    <div
      role={role}
      aria-label={ariaLabel}
      className={cn(
        'flex h-11 shrink-0 items-center gap-2 border-b border-border px-3',
        className
      )}
    >
      {children}
    </div>
  )
}

/** Muted leading label for status, counts, or paths inside a toolbar. */
export function ToolbarLabel({
  children,
  className,
  title
}: {
  children: React.ReactNode
  className?: string
  title?: string
}) {
  return (
    <span className={cn('truncate text-xs text-muted-foreground', className)} title={title}>
      {children}
    </span>
  )
}

/** Pushes the following controls to the right edge of the toolbar. */
export function ToolbarSpacer() {
  return <div className="flex-1" />
}

/** Optional secondary row (tab strips, per-view controls) directly below a toolbar. */
export function ViewSubbar({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2',
        className
      )}
    >
      {children}
    </div>
  )
}
