import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { DiskTreemap } from '@/components/files/DiskTreemap'
import type { TreemapItem } from '@/lib/treemap'
import { tidy, unwrap, messageOf } from '@/lib/api'
import { formatBytes, shortenHome } from '@/lib/format'
import { toast } from 'sonner'
import type { StorageOverview } from '@shared/types/info'
import type { UsageSnapshot } from '@shared/types/cleanup'
import type { VolumeUsage } from '@shared/types/info'

/**
 * Storage tab extras (#11 treemap, #12/#14 usage history, #13 live monitor).
 * Drill-down measures children on demand with bounded walks; usage history
 * records one snapshot per day locally; the monitor polls statfs every 5s
 * while mounted.
 */

export function StorageExtras({
  overview,
  scannedRoot,
  homePath
}: {
  overview: StorageOverview | null
  scannedRoot: string | null
  homePath: string
}) {
  const [treemapRoot, setTreemapRoot] = useState<string | null>(null)
  const [treemapItems, setTreemapItems] = useState<TreemapItem[]>([])
  const [treemapLoading, setTreemapLoading] = useState(false)
  const [history, setHistory] = useState<UsageSnapshot[]>([])
  const [live, setLive] = useState<VolumeUsage[] | null>(null)

  // Initialize the treemap at the scanned root when results arrive.
  useEffect(() => {
    if (scannedRoot) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTreemapRoot(scannedRoot)
    }
  }, [scannedRoot])

  const measureChildren = useCallback(async (dir: string): Promise<void> => {
    setTreemapLoading(true)
    try {
      const listing = await unwrap(tidy().listDirectory(dir))
      const folders = listing.entries.filter((e) => e.isDirectory && !e.name.startsWith('.')).slice(0, 24)
      const items: TreemapItem[] = []
      let fileBytes = 0
      for (const folder of folders) {
        try {
          const size = await unwrap(tidy().getFolderSize(folder.path))
          items.push({ name: folder.name, path: folder.path, bytes: size.bytes })
        } catch {
          items.push({ name: folder.name, path: folder.path, bytes: 0 })
        }
      }
      for (const entry of listing.entries) {
        if (!entry.isDirectory) fileBytes += entry.size
      }
      if (fileBytes > 0) items.push({ name: '[loose files]', path: dir, bytes: fileBytes })
      setTreemapItems(items)
    } catch (cause) {
      toast.error(messageOf(cause))
    } finally {
      setTreemapLoading(false)
    }
  }, [])

  useEffect(() => {
    if (treemapRoot) {
      // Fetch-on-change for the treemap — intentional.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void measureChildren(treemapRoot)
    }
  }, [treemapRoot, measureChildren])

  // Usage history: refresh whenever the scan completes + record snapshots.
  const refreshHistory = useCallback(async (): Promise<void> => {
    try {
      await unwrap(tidy().recordUsageSnapshot())
      setHistory(await unwrap(tidy().getUsageHistory()))
    } catch {
      // history is best-effort
    }
  }, [])

  const scannedRef = useRef<string | null>(null)
  useEffect(() => {
    if (scannedRoot && scannedRef.current !== scannedRoot) {
      scannedRef.current = scannedRoot
      void refreshHistory()
    }
  }, [scannedRoot, refreshHistory])

  // Real-time monitor: poll statfs every 5s while mounted.
  useEffect(() => {
    const poll = async (): Promise<void> => {
      try {
        setLive(await unwrap(tidy().volumesUsage()))
      } catch {
        // ignore poll failures
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 5000)
    return () => clearInterval(timer)
  }, [])

  const volumes = live ?? overview?.volumes ?? []

  return (
    <div className="space-y-7">
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
          <Activity className="size-3.5 text-muted-foreground" />
          Live volumes <span className="text-[11px] font-normal text-muted-foreground">· refreshes every 5s</span>
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {volumes.map((volume) => {
            const usedPercent = volume.total > 0 ? Math.round((volume.used / volume.total) * 100) : 0
            return (
              <div key={volume.path} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-[13px] font-medium">{volume.name}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{formatBytes(volume.free)} free</span>
                </div>
                <Progress value={usedPercent} className="h-1.5" />
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {formatBytes(volume.used)} of {formatBytes(volume.total)} used · {usedPercent}%
                </p>
              </div>
            )
          })}
          {volumes.length === 0 ? <p className="text-xs text-muted-foreground">No volumes readable.</p> : null}
        </div>
      </section>

      {overview && scannedRoot ? (
        <section>
          <h3 className="mb-2 text-[13px] font-semibold">Treemap — {shortenHome(treemapRoot ?? scannedRoot, homePath)}</h3>
          <DiskTreemap
            root={treemapRoot ?? scannedRoot}
            items={treemapItems}
            loading={treemapLoading}
            onDrill={(path) => setTreemapRoot(path)}
            onRefresh={() => treemapRoot && void measureChildren(treemapRoot)}
          />
        </section>
      ) : null}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold">Storage history</h3>
          <Button variant="ghost" size="sm" className="h-6 gap-1 text-[11px]" onClick={() => void refreshHistory()}>
            {history.length === 0 ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            Refresh
          </Button>
        </div>
        {history.length < 2 ? (
          <p className="text-xs text-muted-foreground">
            One snapshot per day is recorded locally (90 days kept) — come back over time to see growth trends here.
          </p>
        ) : (
          <UsageChart snapshots={history.slice(-30)} />
        )}
      </section>
    </div>
  )
}

/** Compact sparkline-style bars of used-space percentage per day. */
function UsageChart({ snapshots }: { snapshots: UsageSnapshot[] }) {
  const boot = snapshots
    .map((snapshot) => ({ at: snapshot.at, volume: snapshot.volumes.find((v) => v.path === '/') }))
    .filter((entry): entry is { at: string; volume: { path: string; used: number; total: number } } => Boolean(entry.volume))
  return (
    <div>
      <div className="flex h-20 items-end gap-1">
        {boot.map(({ at, volume }, index) => {
          const percent = volume.total > 0 ? (volume.used / volume.total) * 100 : 0
          return (
            <div
              key={at ?? index}
              className="group relative flex-1 rounded-t bg-primary/60 hover:bg-primary"
              style={{ height: `${Math.max(percent, 2)}%` }}
              title={`${at}: ${formatBytes(volume.used)} used (${percent.toFixed(1)}%)`}
            />
          )
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Boot volume used %, last {boot.length} day{boot.length === 1 ? '' : 's'} — hover a bar for details.
      </p>
    </div>
  )
}

