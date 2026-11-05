import { Cpu, Laptop, MemoryStick, Monitor } from 'lucide-react'
import { useMetaStore } from '@/stores/browser-store'
import { formatRam } from '@/lib/format'

/**
 * Sidebar "This Mac" equipment card — a compact snapshot of the hardware
 * running Tidy. Reads cached data gathered by the main process; the content
 * is hidden entirely when the sidebar is collapsed to the icon rail.
 */

function chipName(chip: string): string {
  const m = chip.match(/Apple (M\d+)/)
  return m ? `${m[1]} chip` : chip
}

export function HardwareCard() {
  const info = useMetaStore((s) => s.systemInfo)

  if (!info) return null

  const cls = 'flex items-center gap-1.5 text-[11px] text-muted-foreground'

  return (
    <div className="group-data-[collapsible=icon]:hidden">
      <div className="rounded-xl border border-sidebar-border/70 bg-sidebar-accent/40 p-3">
        <div className="mb-2 flex items-center gap-1.5">
          <Laptop className="size-3.5 text-sidebar-primary" />
          <span className="truncate text-[11px] font-semibold">{info.modelName}</span>
          <span className="ml-auto text-[11px] text-muted-foreground">
            This Mac
          </span>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Cpu className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-[11px] font-medium" title={info.chip}>
              {chipName(info.chip)}
            </span>
          </div>

          <div className={cls}>
            <MemoryStick className="size-3.5 text-muted-foreground" />
            <span className="truncate">{formatRam(info.memoryBytes)} RAM</span>
          </div>

          <div className={cls}>
            <Monitor className="size-3.5 text-muted-foreground" />
            <span className="truncate">macOS {info.osVersion}</span>
          </div>
        </div>

        <div className="mt-2.5 flex items-center justify-between border-t border-sidebar-border/60 pt-2 text-[11px] text-muted-foreground">
          <span>{info.totalCores} cores</span>
          <span className="lowercase">{info.architecture}</span>
        </div>
      </div>
    </div>
  )
}