import { useEffect, useMemo, useState } from 'react'
import {
  Eraser,
  HardDrive,
  Loader2,
  FolderOpen,
  Trash2,
  Copy,
  SquareDashed,
  Clock,
  FolderX,
  Scale,
  Package,
  FileQuestion,
  Link2Off,
  Disc3,
  Folders,
  Image,
  GitBranch
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FileTable } from '@/components/files/FileTable'
import type { TableMenuItem } from '@/components/files/FileTable'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { TrashConfirmDialog } from '@/components/dialogs/TrashConfirmDialog'
import { CompareFoldersDialog } from '@/components/dialogs/ToolDialogs'
import { EmptyState } from '@/components/common/EmptyState'
import { FindersView, FINDER_TABS } from './CleanupFinders'
import { StorageExtras } from './StorageExtras'
import type { FinderTab } from './CleanupFinders'
import { ToolbarSpacer, ViewSubbar, ViewToolbar } from '@/components/common/ViewToolbar'
import { tidy, unwrap, codeOf, messageOf } from '@/lib/api'
import { formatBytes, shortenHome } from '@/lib/format'
import { useAppStore } from '@/stores/app-store'
import { useBrowserStore, useMetaStore } from '@/stores/browser-store'
import type { FileEntry } from '@shared/types/files'
import type { DuplicateGroup, ScanProgress as ScanProgressType } from '@shared/types/cleanup'
import type { StorageOverview } from '@shared/types/info'
import type { DevArtifact } from '@shared/types/cleanup'
import { BiggestFoldersChart, CategoryDonut } from './StorageCharts'
import { cn } from 'cn'

type Tab = 'large' | 'duplicates' | 'old' | 'empty' | 'dev' | 'storage' | FinderTab

const LARGE_THRESHOLDS = [
  { value: '100', label: '100 MB' },
  { value: '500', label: '500 MB' },
  { value: '1024', label: '1 GB' },
  { value: '5120', label: '5 GB' },
  { value: 'custom', label: 'Custom…' }
]

const DUP_MIN_SIZES = [
  { value: '1', label: '1 MB' },
  { value: '10', label: '10 MB' },
  { value: '100', label: '100 MB' }
]

const OLD_DAYS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '6 months' },
  { value: '365', label: 'a year' }
]

interface ProgressState {
  phase: ScanProgressType['phase']
  processed: number
  total?: number
  currentPath?: string
}

export function CleanupView() {
  const homePath = useMetaStore((s) => s.homePath)
  const settings = useAppStore((s) => s.settings)
  const patchSettings = useAppStore((s) => s.patchSettings)

  const [tab, setTab] = useState<Tab>('large')
  const [root, setRoot] = useState<string | null>(null)
  const [threshold, setThreshold] = useState<string>(String(settings?.largeFileThresholdMB ?? 100))
  const [customThreshold, setCustomThreshold] = useState('')
  const [dupMinSize, setDupMinSize] = useState<string>(String(settings?.duplicateMinSizeMB ?? 1))
  const [oldDays, setOldDays] = useState<string>('90')

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const [largeFiles, setLargeFiles] = useState<FileEntry[]>([])
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [keepers, setKeepers] = useState<Record<string, string>>({})
  const [oldFiles, setOldFiles] = useState<FileEntry[]>([])
  const [emptyFolders, setEmptyFolders] = useState<string[]>([])
  const [overview, setOverview] = useState<StorageOverview | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [devArtifacts, setDevArtifacts] = useState<DevArtifact[]>([])
  const [scannedRoot, setScannedRoot] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(new Set())
  const [trashDialog, setTrashDialog] = useState<Array<{ path: string; size: number }> | null>(null)

  // Subscribe to scan progress while mounted.
  useEffect(() => {
    tidy().onScanProgress((p: ScanProgressType) => {
      setProgress({ phase: p.phase, processed: p.processed, total: p.total, currentPath: p.currentPath })
    })
    return () => tidy().onScanProgress(null)
  }, [])

  const effectiveRoot = root ?? homePath

  const openFolder = (folderPath: string): void => {
    useBrowserStore.getState().navigate(folderPath)
    useAppStore.getState().setView('files')
  }

  const browse = async (): Promise<void> => {
    try {
      const picked = await unwrap(tidy().pickFolder('Choose a folder to scan'))
      if (picked) setRoot(picked)
    } catch (error) {
      toast.error(messageOf(error))
    }
  }

  const effectiveThresholdMB = (): number => {
    if (threshold === 'custom') {
      const n = Number(customThreshold)
      return Number.isFinite(n) && n > 0 ? n : 100
    }
    return Number(threshold)
  }

  const runLargeScan = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setProgress({ phase: 'listing', processed: 0 })
    setSelectedPaths(new Set())
    try {
      const response = await unwrap(
        tidy().scanLargeFiles({ root: effectiveRoot, thresholdMB: effectiveThresholdMB() })
      )
      setLargeFiles(response.result)
      setScannedRoot(effectiveRoot)
      void patchSettings({ largeFileThresholdMB: effectiveThresholdMB() })
    } catch (cause) {
      if (codeOf(cause) === 'CANCELLED') toast.info('Scan cancelled.')
      else {
        setError(messageOf(cause))
        toast.error(messageOf(cause))
      }
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const runDuplicateScan = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setProgress({ phase: 'listing', processed: 0 })
    try {
      const response = await unwrap(
        tidy().scanDuplicates({
          roots: [effectiveRoot],
          minSizeBytes: Number(dupMinSize) * 1024 * 1024
        })
      )
      const found = response.result
      setGroups(found)
      // Default keeper: first (oldest) file in each group.
      const initial: Record<string, string> = {}
      for (const group of found) {
        if (group.files[0]) initial[group.hash] = group.files[0].path
      }
      setKeepers(initial)
      setScannedRoot(effectiveRoot)
      void patchSettings({ duplicateMinSizeMB: Number(dupMinSize) })
    } catch (cause) {
      if (codeOf(cause) === 'CANCELLED') toast.info('Scan cancelled.')
      else {
        setError(messageOf(cause))
        toast.error(messageOf(cause))
      }
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const runOldScan = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setProgress({ phase: 'listing', processed: 0 })
    setSelectedPaths(new Set())
    try {
      const response = await unwrap(
        tidy().scanOldFiles({ root: effectiveRoot, olderThanDays: Number(oldDays) })
      )
      setOldFiles(response.result)
      setScannedRoot(effectiveRoot)
    } catch (cause) {
      if (codeOf(cause) === 'CANCELLED') toast.info('Scan cancelled.')
      else {
        setError(messageOf(cause))
        toast.error(messageOf(cause))
      }
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const runEmptyFoldersScan = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setProgress({ phase: 'listing', processed: 0 })
    setSelectedPaths(new Set())
    try {
      const response = await unwrap(tidy().scanEmptyFolders({ root: effectiveRoot }))
      setEmptyFolders(response.result)
      setScannedRoot(effectiveRoot)
    } catch (cause) {
      if (codeOf(cause) === 'CANCELLED') toast.info('Scan cancelled.')
      else {
        setError(messageOf(cause))
        toast.error(messageOf(cause))
      }
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const runStorageScan = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setProgress({ phase: 'listing', processed: 0 })
    try {
      const result = await unwrap(tidy().getStorageOverview(effectiveRoot))
      setOverview(result)
      setScannedRoot(effectiveRoot)
    } catch (cause) {
      if (codeOf(cause) === 'CANCELLED') toast.info('Scan cancelled.')
      else {
        setError(messageOf(cause))
        toast.error(messageOf(cause))
      }
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const runDevArtifactsScan = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setProgress({ phase: 'listing', processed: 0 })
    setSelectedPaths(new Set())
    try {
      const response = await unwrap(tidy().scanDevArtifacts(effectiveRoot))
      setDevArtifacts(response.result)
      setScannedRoot(effectiveRoot)
    } catch (cause) {
      if (codeOf(cause) === 'CANCELLED') toast.info('Scan cancelled.')
      else {
        setError(messageOf(cause))
        toast.error(messageOf(cause))
      }
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const cancelScan = (): void => {
    void unwrap(tidy().cancelScan('current')).catch(() => {})
  }

  /**
   * The TrashConfirmDialog performs the actual trashing (and reports
   * failures); this only reconciles the in-memory scan results.
   */
  const reconcileAfterTrash = (items: Array<{ path: string; size: number }>): void => {
    const removed = new Set(items.map((i) => i.path))
    setLargeFiles((current) => current.filter((f) => !removed.has(f.path)))
    setOldFiles((current) => current.filter((f) => !removed.has(f.path)))
    setEmptyFolders((current) => current.filter((p) => !removed.has(p)))
    setDevArtifacts((current) =>
      current.filter((a) => !removed.has(a.path) && ![...removed].some((r) => a.path.startsWith(r + '/')))
    )
    setGroups((current) =>
      current
        .map((group) => ({ ...group, files: group.files.filter((f) => !removed.has(f.path)) }))
        .filter((group) => group.files.length > 1)
    )
    setKeepers((current) => {
      const next: Record<string, string> = {}
      for (const group of groups) {
        const keeper = current[group.hash]
        if (keeper && !removed.has(keeper)) next[group.hash] = keeper
        else if (group.files.find((f) => !removed.has(f.path))) {
          next[group.hash] = group.files.find((f) => !removed.has(f.path))!.path
        }
      }
      return next
    })
    setSelectedPaths(new Set())
  }

  const duplicateTrashPlan = useMemo(() => {
    const items: Array<{ path: string; size: number }> = []
    for (const group of groups) {
      const keeper = keepers[group.hash]
      for (const file of group.files) {
        if (file.path !== keeper) items.push({ path: file.path, size: file.size })
      }
    }
    return items
  }, [groups, keepers])

  const largeMenu = (entry: FileEntry): TableMenuItem[] => [
    { label: 'Reveal in Finder', onSelect: () => void unwrap(tidy().revealInFinder(entry.path)).catch(() => {}) },
    {
      label: 'Move to Trash',
      destructive: true,
      onSelect: () => setTrashDialog([{ path: entry.path, size: entry.size }])
    }
  ]

  const dupMenu = (entry: FileEntry): TableMenuItem[] => [
    { label: 'Reveal in Finder', onSelect: () => void unwrap(tidy().revealInFinder(entry.path)).catch(() => {}) },
    { label: 'Keep this copy', onSelect: () => markKeeper(entry) },
    {
      label: 'Move to Trash',
      destructive: true,
      onSelect: () => setTrashDialog([{ path: entry.path, size: entry.size }])
    }
  ]

  const markKeeper = (entry: FileEntry): void => {
    const group = groups.find((g) => g.files.some((f) => f.path === entry.path))
    if (!group) return
    setKeepers((current) => ({ ...current, [group.hash]: entry.path }))
  }

  const progressPercent = progress
    ? progress.total
      ? Math.round((progress.processed / progress.total) * 100)
      : 15
    : 0

  const phaseLabel: Record<string, string> = {
    listing: 'Listing files…',
    'hashing-partial': 'Comparing candidates…',
    'hashing-full': 'Verifying identical content…',
    done: 'Finishing…'
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewToolbar>
        <div className="flex flex-wrap rounded-md border border-border p-0.5">
          {(
            [
              { id: 'large', label: 'Large files', icon: HardDrive },
              { id: 'duplicates', label: 'Duplicates', icon: Copy },
              { id: 'old', label: 'Old files', icon: Clock },
              { id: 'empty', label: 'Empty folders', icon: FolderX },
              { id: 'dev', label: 'Dev artifacts', icon: Package },
              { id: 'storage', label: 'Storage', icon: Scale },
              { id: 'empty-files', label: 'Empty files', icon: FileQuestion },
              { id: 'broken-links', label: 'Broken links', icon: Link2Off },
              { id: 'temp-files', label: 'Temp files', icon: FileQuestion },
              { id: 'old-installers', label: 'Old installers', icon: Disc3 },
              { id: 'dup-folders', label: 'Dup folders', icon: Folders },
              { id: 'sim-images', label: 'Similar images', icon: Image },
              { id: 'cache', label: 'Caches', icon: Trash2 },
              { id: 'git', label: 'Git repos', icon: GitBranch }
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring',
                tab === id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
        <ToolbarSpacer />
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => void browse()}
          disabled={busy}
        >
          <FolderOpen className="size-3.5" />
          <span className="max-w-52 truncate">{shortenHome(effectiveRoot, homePath)}</span>
        </Button>
      </ViewToolbar>

      <ViewSubbar>
        {tab === 'large' ? (
          <>
            <span className="text-xs text-muted-foreground">Files larger than</span>
            <Select value={threshold} onValueChange={setThreshold} disabled={busy}>
              <SelectTrigger size="sm" className="w-28" aria-label="Size threshold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LARGE_THRESHOLDS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {threshold === 'custom' ? (
              <Input
                value={customThreshold}
                onChange={(e) => setCustomThreshold(e.target.value.replace(/[^\d.]/g, ''))}
                className="h-7 w-20 text-xs"
                placeholder="MB"
                aria-label="Custom threshold in MB"
              />
            ) : null}
            <Button size="sm" onClick={() => void runLargeScan()} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Eraser className="size-3.5" />}
              Scan
            </Button>
          </>
        ) : tab === 'old' ? (
          <>
            <span className="text-xs text-muted-foreground">Not modified in</span>
            <Select value={oldDays} onValueChange={setOldDays} disabled={busy}>
              <SelectTrigger size="sm" className="w-32" aria-label="Age threshold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OLD_DAYS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => void runOldScan()} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Clock className="size-3.5" />}
              Scan
            </Button>
          </>
        ) : tab === 'empty' ? (
          <>
            <span className="text-xs text-muted-foreground">
              Folders with nothing inside (including nested ones)
            </span>
            <Button size="sm" onClick={() => void runEmptyFoldersScan()} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FolderX className="size-3.5" />}
              Scan
            </Button>
          </>
        ) : tab === 'dev' ? (
          <>
            <span className="text-xs text-muted-foreground">
              Regeneratable folders — node_modules, DerivedData, dist, build… (outermost only)
            </span>
            <Button size="sm" onClick={() => void runDevArtifactsScan()} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Package className="size-3.5" />}
              Scan
            </Button>
          </>
      ) : FINDER_TABS.includes(tab as FinderTab) ? (
        <FindersView tab={tab as FinderTab} onOpenCompare={() => setCompareOpen(true)} />
      ) : tab === 'storage' ? (
          <>
            <span className="text-xs text-muted-foreground">
              Volumes, biggest folders, and what’s using space
            </span>
            <Button size="sm" onClick={() => void runStorageScan()} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Scale className="size-3.5" />}
              Analyze
            </Button>
          </>
        ) : (
          <>
            <span className="text-xs text-muted-foreground">Consider files at least</span>
            <Select value={dupMinSize} onValueChange={setDupMinSize} disabled={busy}>
              <SelectTrigger size="sm" className="w-24" aria-label="Minimum duplicate size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DUP_MIN_SIZES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button size="sm" onClick={() => void runDuplicateScan()} disabled={busy}>
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
                    Find duplicates
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Verified by content hash — identical files only</TooltipContent>
            </Tooltip>
          </>
        )}
        {busy ? (
          <Button size="sm" variant="ghost" onClick={cancelScan}>
            Cancel
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-xs"
          onClick={() => setCompareOpen(true)}
          disabled={busy}
        >
          <Folders className="size-3.5" />
          Compare folders…
        </Button>
        <div className="flex-1" />
        {(tab === 'large' || tab === 'old') && selectedPaths.size > 0 && !busy ? (
          <Button
            variant="destructive"
            size="sm"
            className="gap-1.5"
            onClick={() =>
              setTrashDialog(
                (tab === 'large' ? largeFiles : oldFiles)
                  .filter((f) => selectedPaths.has(f.path))
                  .map((f) => ({ path: f.path, size: f.size }))
              )
            }
          >
            <Trash2 className="size-3.5" />
            Trash selected ({selectedPaths.size})
          </Button>
        ) : null}
        {tab === 'dev' && selectedPaths.size > 0 && !busy ? (
          <Button
            variant="destructive"
            size="sm"
            className="gap-1.5"
            onClick={() =>
              setTrashDialog(devArtifacts.filter((a) => selectedPaths.has(a.path)).map((a) => ({ path: a.path, size: a.bytes })))
            }
          >
            <Trash2 className="size-3.5" />
            Trash {selectedPaths.size} artifact{selectedPaths.size === 1 ? '' : 's'} (
            {formatBytes(devArtifacts.filter((a) => selectedPaths.has(a.path)).reduce((sum, a) => sum + a.bytes, 0))})
          </Button>
        ) : null}
        {tab === 'empty' && selectedPaths.size > 0 && !busy ? (
          <Button
            variant="destructive"
            size="sm"
            className="gap-1.5"
            onClick={() =>
              setTrashDialog(emptyFolders.filter((p) => selectedPaths.has(p)).map((p) => ({ path: p, size: 0 })))
            }
          >
            <Trash2 className="size-3.5" />
            Trash {selectedPaths.size} empty folder{selectedPaths.size === 1 ? '' : 's'}
          </Button>
        ) : null}
        {tab === 'duplicates' && duplicateTrashPlan.length > 0 && !busy ? (
          <Button
            variant="destructive"
            size="sm"
            className="gap-1.5"
            onClick={() => setTrashDialog(duplicateTrashPlan)}
          >
            <Trash2 className="size-3.5" />
            Trash {duplicateTrashPlan.length} duplicate{duplicateTrashPlan.length === 1 ? '' : 's'} (
            {formatBytes(duplicateTrashPlan.reduce((s, i) => s + i.size, 0))})
          </Button>
        ) : null}
      </ViewSubbar>

      {busy && progress ? (
        <div className="space-y-1 border-b border-border px-3 py-2">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {phaseLabel[progress.phase] ?? 'Working…'}
              {progress.total ? ` · ${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()}` : ''}
            </span>
            <span className="max-w-72 truncate">{progress.currentPath ?? ''}</span>
          </div>
          <Progress value={progressPercent} className="h-1" />
        </div>
      ) : null}

      {error ? <p className="px-4 py-2 text-xs text-destructive">{error}</p> : null}

      {tab === 'large' || tab === 'old' ? (
        <FileTable
          ariaLabel={tab === 'large' ? 'Large files' : 'Old files'}
          entries={tab === 'large' ? largeFiles : oldFiles}
          selectedPaths={selectedPaths}
          onRowClick={(entry, _index, event) =>
            setSelectedPaths((current) => {
              const next = new Set(current)
              if (event.metaKey || event.shiftKey) {
                if (next.has(entry.path)) next.delete(entry.path)
                else next.add(entry.path)
              } else {
                return new Set([entry.path])
              }
              return next
            })
          }
          onOpen={() => {}}
          buildMenu={largeMenu}
          onPreview={(entry) => void unwrap(tidy().previewFile(entry.path)).catch(() => {})}
          showPath
          emptyState={
            tab === 'large' ? (
              <EmptyState
                icon={HardDrive}
                title={scannedRoot ? 'No files above the threshold' : 'Find space hogs'}
                description={
                  scannedRoot
                    ? `Nothing larger than ${effectiveThresholdMB()} MB in ${shortenHome(scannedRoot, homePath)}.`
                    : 'Choose a size threshold and scan a folder to see its largest files.'
                }
              />
            ) : (
              <EmptyState
                icon={Clock}
                title={scannedRoot ? `Nothing older than ${oldDays} days` : 'Find forgotten files'}
                description={
                  scannedRoot
                    ? `Every file in ${shortenHome(scannedRoot, homePath)} was modified within the last ${oldDays} days.`
                    : 'Pick an age and scan a folder to see files you haven’t touched in a while.'
                }
              />
            )
          }
        />
      ) : tab === 'empty' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {emptyFolders.length === 0 ? (
            <EmptyState
              icon={FolderX}
              title={scannedRoot ? 'No empty folders' : 'Find empty folders'}
              description={
                scannedRoot
                  ? `No empty folder trees found in ${shortenHome(scannedRoot, homePath)}.`
                  : 'Scans for folders whose entire subtree contains no files — review before trashing.'
              }
            />
          ) : (
            <ul className="p-3">
              {emptyFolders.map((folder) => (
                <li key={folder} className="flex items-center gap-2.5 border-b border-border/40 px-1 py-1.5 text-xs last:border-b-0">
                  <input
                    type="checkbox"
                    checked={selectedPaths.has(folder)}
                    onChange={(event) =>
                      setSelectedPaths((current) => {
                        const next = new Set(current)
                        if (event.target.checked) next.add(folder)
                        else next.delete(folder)
                        return next
                      })
                    }
                    aria-label={`Select ${folder}`}
                  />
                  <FolderX className="size-3.5 shrink-0 text-muted-foreground/70" />
                  <span className="min-w-0 flex-1 truncate" title={folder}>
                    {folder}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-[11px]"
                    onClick={() => void unwrap(tidy().revealInFinder(folder)).catch(() => {})}
                  >
                    Reveal
                  </Button>
                </li>
              ))}
              <li className="px-1 pt-2 text-[11px] text-muted-foreground">
                Nested folders inside a selected tree are removed together with it.
              </li>
            </ul>
          )}
        </div>
      ) : tab === 'dev' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {devArtifacts.length === 0 ? (
            <EmptyState
              icon={Package}
              title={scannedRoot ? 'No dev artifacts found' : 'Find regeneratable folders'}
              description={
                scannedRoot
                  ? `No node_modules, DerivedData, dist, build, or similar folders in ${shortenHome(scannedRoot, homePath)}.`
                  : 'Finds the folders every developer deletes first — regeneratable build output and dependencies. Review, then Trash.'
              }
            />
          ) : (
            <ul className="p-3">
              <li className="mb-2 flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
                <SquareDashed className="size-3" />
                {devArtifacts.length} artifacts · {formatBytes(devArtifacts.reduce((sum, a) => sum + a.bytes, 0))} total — everything here can be regenerated by your tools.
              </li>
              {devArtifacts.map((artifact) => (
                <li
                  key={artifact.path}
                  className={cn(
                    'flex items-center gap-2.5 border-b border-border/40 px-1 py-1.5 text-xs last:border-b-0',
                    selectedPaths.has(artifact.path) && 'bg-primary/[0.06]'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selectedPaths.has(artifact.path)}
                    onChange={(event) =>
                      setSelectedPaths((current) => {
                        const next = new Set(current)
                        if (event.target.checked) next.add(artifact.path)
                        else next.delete(artifact.path)
                        return next
                      })
                    }
                    aria-label={`Select ${artifact.path}`}
                  />
                  <Package className="size-3.5 shrink-0 text-muted-foreground/70" />
                  <span className="w-36 shrink-0 truncate font-medium" title={artifact.name}>
                    {artifact.name}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground" title={artifact.path}>
                    {artifact.path}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{formatBytes(artifact.bytes)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 px-1.5 text-[11px]"
                    onClick={() => void unwrap(tidy().revealInFinder(artifact.path)).catch(() => {})}
                  >
                    Reveal
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : FINDER_TABS.includes(tab as FinderTab) ? (
        <FindersView tab={tab as FinderTab} onOpenCompare={() => setCompareOpen(true)} />
      ) : tab === 'storage' ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {!overview ? (
            <EmptyState
              icon={Scale}
              title={scannedRoot ? 'Nothing analyzed yet' : 'See what’s using your disk'}
              description="Analyze volumes, the biggest folders, and how your space splits by file category. Everything is computed locally."
            />
          ) : (
            <div className="mx-auto w-full space-y-7">
              <section>
                <h3 className="mb-2 text-[13px] font-semibold">Volumes</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {overview.volumes.map((volume) => {
                    const usedPercent = volume.total > 0 ? Math.round((volume.used / volume.total) * 100) : 0
                    return (
                      <div key={volume.path} className="rounded-lg border border-border p-3">
                        <div className="mb-2 flex items-baseline justify-between">
                          <span className="text-[13px] font-medium">{volume.name}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {formatBytes(volume.free)} free
                          </span>
                        </div>
                        <Progress value={usedPercent} className="h-1.5" />
                        <p className="mt-1.5 text-[11px] text-muted-foreground">
                          {formatBytes(volume.used)} of {formatBytes(volume.total)} used · {usedPercent}%
                        </p>
                      </div>
                    )
                  })}
                </div>
              </section>

              <div>
                <p className="mb-2 text-[11px] text-muted-foreground">
                  Scanned {shortenHome(scannedRoot ?? effectiveRoot, homePath)}
                </p>
                <BiggestFoldersChart folders={overview.largestFolders} onOpen={openFolder} />
                {overview.truncated ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    The walk was capped to stay fast, so very deep trees may be undercounted.
                  </p>
                ) : null}
              </div>

              <CategoryDonut categories={overview.categories} />
              {overview ? (
                <StorageExtras overview={overview} scannedRoot={scannedRoot} homePath={homePath} />
              ) : null}
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.length === 0 ? (
            <EmptyState
              icon={Copy}
              title={scannedRoot ? 'No verified duplicates' : 'Find duplicate files safely'}
              description={
                scannedRoot
                  ? `No identical files (≥ ${dupMinSize} MB) were found in ${shortenHome(scannedRoot, homePath)}.`
                  : 'Files are compared by content hash — only truly identical files are reported. Choose a folder and scan.'
              }
            />
          ) : (
            <ul className="space-y-3 p-3">
              {groups.map((group) => {
                const keeper = keepers[group.hash]
                return (
                  <li key={group.hash} className="rounded-lg border border-border">
                    <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                      <div className="text-xs">
                        <span className="font-medium">{group.files.length} identical files</span>
                        <span className="text-muted-foreground">
                          {' '}
                          · {formatBytes(group.size)} each · {formatBytes(group.size * (group.files.length - 1))} reclaimable
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-muted-foreground/60">
                        {group.hash.slice(0, 12)}
                      </span>
                    </div>
                    <ul>
                      {group.files.map((file) => {
                        const isKeeper = file.path === keeper
                        const row = (
                          <div
                            className={cn(
                              'flex items-center gap-2.5 px-3 py-1.5 text-xs',
                              isKeeper && 'bg-emerald-500/[0.07]'
                            )}
                          >
                            <input
                              type="radio"
                              name={`keeper-${group.hash}`}
                              checked={isKeeper}
                              onChange={() =>
                                setKeepers((current) => ({ ...current, [group.hash]: file.path }))
                              }
                              aria-label={`Keep ${file.path}`}
                              className="accent-[var(--primary)]"
                            />
                            <span className={cn('min-w-0 flex-1 truncate', isKeeper ? 'font-medium' : 'text-muted-foreground')}>
                              {file.path}
                            </span>
                            <span className="text-muted-foreground">{formatBytes(file.size)}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-[11px]"
                              onClick={() => void unwrap(tidy().revealInFinder(file.path)).catch(() => {})}
                            >
                              Reveal
                            </Button>
                          </div>
                        )
                        return (
                          <li key={file.path}>
                            <ContextMenu>
                              <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
                              <ContextMenuContent>
                                {dupMenu(file).map((item) => (
                                  <ContextMenuRowItem key={item.label} item={item} />
                                ))}
                              </ContextMenuContent>
                            </ContextMenu>
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                )
              })}
              <li className="flex items-center gap-1.5 px-1 pb-2 text-[11px] text-muted-foreground">
                <SquareDashed className="size-3" />
                Pick the copy to keep in each group; everything else goes to Trash after your confirmation.
              </li>
            </ul>
          )}
        </div>
      )}

      {compareOpen ? <CompareFoldersDialog onClose={() => setCompareOpen(false)} /> : null}
      {trashDialog ? (
        <TrashConfirmDialog
          items={trashDialog}
          onClose={(trashed) => {
            const items = trashDialog
            setTrashDialog(null)
            if (trashed) reconcileAfterTrash(items)
          }}
        />
      ) : null}
    </div>
  )
}

function ContextMenuRowItem({ item }: { item: TableMenuItem }) {
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
