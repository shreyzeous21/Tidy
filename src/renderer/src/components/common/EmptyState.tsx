import type { LucideIcon } from 'lucide-react'
import { AlertTriangle } from 'lucide-react'
import { cn } from 'cn'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-16 text-center', className)}>
      <Icon className="size-8 text-muted-foreground/60" strokeWidth={1.5} />
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

/** Inline guidance shown when macOS privacy permissions block a folder. */
export function PermissionNotice({ message, className }: { message: string; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5',
        className
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="text-xs leading-relaxed">
        <p className="font-medium text-amber-700 dark:text-amber-300">Permission needed</p>
        <p className="text-amber-700/80 dark:text-amber-300/80">{message}</p>
      </div>
    </div>
  )
}
