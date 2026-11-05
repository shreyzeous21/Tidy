import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Download,
  FolderOpen,
  HardDrive,
  LayoutDashboard,
  Loader2,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/EmptyState'
import { ToolbarLabel, ToolbarSpacer, ViewToolbar } from '@/components/common/ViewToolbar'
import { tidy, unwrap, messageOf } from '@/lib/api'
import { formatBytes, shortenHome } from '@/lib/format'
import { useAppStore } from '@/stores/app-store'
import { useBrowserStore, useMetaStore } from '@/stores/browser-store'
import { categoryForFile } from '@shared/constants/categories'
import { BiggestFoldersChart, CategoryDonut } from '../cleanup/StorageCharts'
import { ActivityChart, VolumesChart, VolumeGauge } from './OverviewCharts'
import type { ScanProgress } from '@shared/types/cleanup'
import type { StorageOverview } from '@shared/types/info'
import type { OperationHistoryItem } from '@shared/types/settings'
import type { FileEntry } from '@shared/types/files'
import type { LucideIcon } from 'lucide-react'

/**
 * Overview — the charts dashboard. Storage figures come from the bounded
 * `getStorageOverview` walk (cached between visits; refresh re-scans), while
 * activity and Downloads charts read cheap local data on mount.
 */

// Survives view switches so returning to Overview doesn't re-walk the disk.
let overviewCache: { root: string; data: StorageOverview } | null = null

function Stat({
  icon: Icon,
  label,
  value,
  hint
}: {
  icon: LucideIcon
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-3.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className="mt-1.5 text-[19px] font-semibold tabular-nums">{value}</p>
      {hint ? <p className="truncate text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function OverviewView() {
  const homePath = useMetaStore((s) => s.homePath)

  const [root, setRoot] = useState<string | null>(null)
  const [overview, setOverview] = useState<StorageOverview | null>(null)
  const [busy, setBusy] = useState(false)
  const [processed, setProcessed] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  const [history, setHistory] = useState<OperationHistoryItem[]>([])
  const [downloads, setDownloads] = useState<FileEntry[]>([])
  const [trashCount, setTrashCount] = useState<number | null>(null)

  // Cheap local data: always available, no heavy scan.
  useEffect(() => {
    void unwrap(tidy().getHistory())
      .then(setHistory)
      .catch(() => {})
    void unwrap(tidy().scanDownloads())
      .then((listing) => setDownloads(listing.entries))
      .catch(() => {})
    void unwrap(tidy().listTrash())
      .then((listing) => setTrashCount(listing.permissionDenied ? null : listing.entries.length))
      .catch(() => {})
  }, [])

  // Scan progress for the storage walk.
  useEffect(() => {
    tidy().onScanProgress((progress: ScanProgress) => {
      if (progress.phase === 'listing') setProcessed(progress.processed)
    })
    return () => tidy().onScanProgress(null)
  }, [])

  // Storage overview: cached per root, re-walked on refresh.
  useEffect(() => {
    const target = root ?? homePath
    if (!target) return
    if (overviewCache && overviewCache.root === target) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOverview(overviewCache.data)
      return
    }
    let cancelled = false
    setBusy(true)
    setError(null)
    setProcessed(0)
    void unwrap(tidy().getStorageOverview(target))
      .then((data) => {
        if (cancelled) return
        overviewCache = { root: target, data }
        setOverview(data)
      })
      .catch((cause) => {
        if (!cancelled) setError(messageOf(cause))
      })
      .finally(() => {
        if (cancelled) return
        setBusy(false)
        setProcessed(null)
      })
    return () => {
      cancelled = true
    }
  }, [root, homePath, refreshToken])

  const refresh = (): void => {
    overviewCache = null
    setRefreshToken((token) => token + 1)
  }

  const chooseRoot = async (): Promise<void> => {
    try {
      const dir = await unwrap(tidy().pickFolder('Analyze folder'))
      if (dir) setRoot(dir)
    } catch {
      // A cancelled picker is not an error.
    }
  }

  const openFolder = (folderPath: string): void => {
    useBrowserStore.getState().navigate(folderPath)
    useAppStore.getState().setView('files')
  }

  const primaryVolume = overview?.volumes[0]
  const diskUsedPct = primaryVolume
    ? Math.round((primaryVolume.used / primaryVolume.total) * 100)
    : null

  const downloadsStats = useMemo(() => {
    let bytes = 0
    let files = 0
    for (const entry of downloads) {
      if (entry.isDirectory) continue
      files += 1
      bytes += entry.size
    }
    return { bytes, files }
  }, [downloads])

  const downloadsCategories = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of downloads) {
      if (entry.isDirectory) continue
      const category = categoryForFile(entry.name)
      map.set(category, (map.get(category) ?? 0) + entry.size)
    }
    return [...map.entries()].map(([category, bytes]) => ({ category, bytes }))
  }, [downloads])

  const activeRoot = root ?? homePath

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewToolbar>
        <ToolbarLabel>
          {busy
            ? `Scanning ${shortenHome(activeRoot, homePath)}${processed ? ` · ${processed.toLocaleString()} items` : ''}...`
            : `Analyzed ${shortenHome(activeRoot, homePath)}`}
        </ToolbarLabel>
        <ToolbarSpacer />
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => void chooseRoot()}>
          <FolderOpen className="size-3.5" />
          Choose folder
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={refresh}
          disabled={busy}
        >
          <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </ViewToolbar>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="w-full space-y-4">
          {/* Headline figures */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <Stat
              icon={HardDrive}
              label="Disk used"
              value={diskUsedPct !== null ? `${diskUsedPct}%` : '—'}
              hint={primaryVolume ? `${formatBytes(primaryVolume.used)} of ${formatBytes(primaryVolume.total)}` : 'Measuring...'}
            />
            <Stat
              icon={HardDrive}
              label="Free space"
              value={primaryVolume ? formatBytes(primaryVolume.free) : '—'}
              hint={primaryVolume?.name}
            />
            <Stat
              icon={Download}
              label="Downloads"
              value={String(downloadsStats.files)}
              hint={formatBytes(downloadsStats.bytes)}
            />
            <Stat
              icon={Trash2}
              label="In Trash"
              value={trashCount !== null ? String(trashCount) : '—'}
              hint={trashCount === null ? 'Needs Full Disk Access' : 'items'}
            />
            <Stat icon={Activity} label="Actions" value={String(history.length)} hint="recorded locally" />
          </div>

          {/* Storage charts */}
          {overview ? (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                {primaryVolume ? (
                  <section className="rounded-xl border border-border bg-card/40 p-4">
                    <header className="mb-3 flex items-baseline justify-between gap-3">
                      <h3 className="text-[13px] font-semibold">Disk usage</h3>
                      <span className="text-[11px] text-muted-foreground">{primaryVolume.name}</span>
                    </header>
                    <VolumeGauge volume={primaryVolume} />
                  </section>
                ) : (
                  <section className="rounded-xl border border-border bg-card/40 p-4">
                    <h3 className="text-[13px] font-semibold">Disk usage</h3>
                    <p className="mt-2 text-xs text-muted-foreground">No volume information available.</p>
                  </section>
                )}
                <CategoryDonut categories={overview.categories} title="Storage by category" />
              </div>

              <BiggestFoldersChart folders={overview.largestFolders} onOpen={openFolder} />

              {overview.truncated ? (
                <p className="text-[11px] text-muted-foreground">
                  The storage walk was capped to stay fast, so very deep trees may be undercounted.
                </p>
              ) : null}
            </>
          ) : busy || !error ? (
            <section className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Analyzing your disk...
            </section>
          ) : (
            <EmptyState
              icon={HardDrive}
              title="Couldn't analyze this folder"
              description={error ?? undefined}
              action={
                <Button variant="outline" size="sm" onClick={refresh}>
                  Try again
                </Button>
              }
            />
          )}

          {/* Activity is local history — independent of the storage walk. */}
          <ActivityChart history={history} />

          <div className="grid gap-4 lg:grid-cols-2">
            {downloadsCategories.length > 0 ? (
              <CategoryDonut categories={downloadsCategories} title="Downloads by type" />
            ) : (
              <section className="rounded-xl border border-border bg-card/40 p-4">
                <h3 className="text-[13px] font-semibold">Downloads by type</h3>
                <p className="mt-2 text-xs text-muted-foreground">No files in Downloads.</p>
              </section>
            )}
            {overview ? <VolumesChart volumes={overview.volumes} /> : null}
          </div>

          <p className="flex items-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
            <LayoutDashboard className="size-3" />
            All figures are computed locally and never leave this Mac.
          </p>
        </div>
      </div>
    </div>
  )
}
