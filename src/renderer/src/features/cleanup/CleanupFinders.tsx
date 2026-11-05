import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Loader2,
  Package,
  Link2Off,
  FileQuestion,
  Disc3,
  Folders,
  Image,
  GitBranch,
  Trash2,
  Search as SearchIcon
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { FileTable } from '@/components/files/FileTable'
import type { TableMenuItem } from '@/components/files/FileTable'
import { TrashConfirmDialog } from '@/components/dialogs/TrashConfirmDialog'
import { GitStatusDialog } from '@/components/dialogs/ToolDialogs'
import { EmptyState } from '@/components/common/EmptyState'
import { ToolbarLabel, ToolbarSpacer } from '@/components/common/ViewToolbar'
import { tidy, unwrap, messageOf } from '@/lib/api'
import { formatBytes, shortenHome, baseName } from '@/lib/format'
import { useMetaStore } from '@/stores/browser-store'
import type { FileEntry } from '@shared/types/files'
import type {
  BrokenLink,
  CacheItem,
  DuplicateFolderGroup,
  RepoInfo,
  SimilarImageGroup
} from '@shared/types/cleanup'
import { cn } from 'cn'

/**
 * Second wave of Clean Up finders (empty files, broken links, temp files,
 * old installers, duplicate folders, similar images, caches, git repos).
 * Split into a scan hook + controls + results so the controls live in the
 * subbar and the results below — the same structure every other tab uses.
 */

export type FinderTab =
  | 'empty-files'
  | 'broken-links'
  | 'temp-files'
  | 'old-installers'
  | 'dup-folders'
  | 'sim-images'
  | 'cache'
  | 'git'

export const FINDER_TABS: FinderTab[] = [
  'empty-files',
  'broken-links',
  'temp-files',
  'old-installers',
  'dup-folders',
  'sim-images',
  'cache',
  'git'
]

const FILE_TABS: FinderTab[] = ['empty-files', 'temp-files', 'old-installers']

const TAB_HINTS: Record<FinderTab, string> = {
  'empty-files': 'Zero-byte files',
  'broken-links': 'Symlinks to missing targets',
  'temp-files': 'Leftover .tmp / .part / ~$ patterns',
  'old-installers': 'DMG / PKG / ISO untouched for 30+ days',
  'dup-folders': 'Byte-identical folder trees, hash-verified',
  'sim-images': 'Perceptually similar images (dHash)',
  cache: 'Cache folders by size — they rebuild automatically',
  git: 'Repositories with branch, status, and .git size'
}

const TAB_TITLES: Record<FinderTab, string> = {
  'empty-files': 'Empty files',
  'broken-links': 'Broken links',
  'temp-files': 'Temp files',
  'old-installers': 'Old installers',
  'dup-folders': 'Duplicate folders',
  'sim-images': 'Similar images',
  cache: 'Caches',
  git: 'Git repositories'
}

export interface FinderScan {
  tab: FinderTab
  busy: boolean
  progressLabel: string | null
  scannedRoot: string | null
  scan: () => void
  browse: () => void
  effectiveRoot: string
  fileResults: FileEntry[]
  brokenLinks: BrokenLink[]
  dupFolders: DuplicateFolderGroup[]
  simImages: SimilarImageGroup[]
  cacheItems: CacheItem[]
  repos: RepoInfo[]
  selectedPaths: ReadonlySet<string>
  setSelectedPaths: (updater: (current: ReadonlySet<string>) => ReadonlySet<string>) => void
  onTrash: (paths: string[]) => void
}

export function useFinderScan(tab: FinderTab): FinderScan {
  const homePath = useMetaStore((s) => s.homePath)
  const [root, setRoot] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progressLabel, setProgressLabel] = useState<string | null>(null)
  const [scannedRoot, setScannedRoot] = useState<string | null>(null)
  const [fileResults, setFileResults] = useState<FileEntry[]>([])
  const [brokenLinks, setBrokenLinks] = useState<BrokenLink[]>([])
  const [dupFolders, setDupFolders] = useState<DuplicateFolderGroup[]>([])
  const [simImages, setSimImages] = useState<SimilarImageGroup[]>([])
  const [cacheItems, setCacheItems] = useState<CacheItem[]>([])
  const [repos, setRepos] = useState<RepoInfo[]>([])
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(new Set())
  const [reconcileTick, setReconcileTick] = useState(0)

  const effectiveRoot =
    tab === 'cache' ? `${homePath === '/' ? '' : homePath}/Library/Caches` : (root ?? homePath)

  useEffect(() => {
    return tidy().onScanProgress((p) => {
      setProgressLabel(
        p.phase === 'done'
          ? null
          : `${p.processed.toLocaleString()}${p.total ? ` / ${p.total.toLocaleString()}` : ''}`
      )
    })
  }, [])

  const trashPathsRef = useRef<string[]>([])
  const onTrash = useCallback((paths: string[]): void => {
    trashPathsRef.current = paths
    setReconcileTick((t) => t + 1)
  }, [])

  // After a confirmed trash, drop the removed paths (and nested ones) from
  // the in-memory results.
  useEffect(() => {
    if (reconcileTick === 0) return
    const removedSet = new Set(trashPathsRef.current)
    setFileResults((current) => current.filter((f) => !removedSet.has(f.path)))
    setBrokenLinks((current) => current.filter((l) => !removedSet.has(l.path)))
    setDupFolders((current) =>
      current
        .map((g) => ({ ...g, paths: g.paths.filter((p) => !removedSet.has(p)) }))
        .filter((g) => g.paths.length > 1)
    )
    setSimImages((current) =>
      current
        .map((g) => ({ ...g, images: g.images.filter((i) => !removedSet.has(i.path)) }))
        .filter((g) => g.images.length > 1)
    )
    setCacheItems((current) => current.filter((c) => !removedSet.has(c.path)))
    setRepos((current) => current.filter((r) => !removedSet.has(r.path)))
    setSelectedPaths(new Set())
    trashPathsRef.current = []
  }, [reconcileTick])

  const browse = useCallback((): void => {
    void unwrap(tidy().pickFolder('Choose a folder to scan'))
      .then((picked) => {
        if (picked) setRoot(picked)
      })
      .catch((cause) => toast.error(messageOf(cause)))
  }, [])

  const scan = useCallback((): void => {
    setBusy(true)
    setSelectedPaths(new Set())
    setProgressLabel('…')
    const run = async (): Promise<void> => {
      switch (tab) {
        case 'empty-files':
          setFileResults((await unwrap(tidy().scanEmptyFiles(effectiveRoot))).result)
          break
        case 'broken-links':
          setBrokenLinks((await unwrap(tidy().scanBrokenLinks(effectiveRoot))).result)
          break
        case 'temp-files':
          setFileResults((await unwrap(tidy().scanTempFiles(effectiveRoot))).result)
          break
        case 'old-installers':
          setFileResults((await unwrap(tidy().scanOldInstallers(effectiveRoot))).result)
          break
        case 'dup-folders':
          setDupFolders((await unwrap(tidy().scanDuplicateFolders(effectiveRoot))).result)
          break
        case 'sim-images':
          setSimImages((await unwrap(tidy().scanSimilarImages(effectiveRoot))).result)
          break
        case 'cache':
          setCacheItems((await unwrap(tidy().scanCache(effectiveRoot))).result)
          break
        case 'git':
          setRepos((await unwrap(tidy().scanGitRepos(effectiveRoot))).result)
          break
      }
      setScannedRoot(effectiveRoot)
    }
    void run()
      .catch((cause) => {
        console.error('[tidy] finder scan failed:', cause)
        toast.error(messageOf(cause))
      })
      .finally(() => {
        setBusy(false)
        setProgressLabel(null)
      })
  }, [tab, effectiveRoot])

  return {
    tab,
    busy,
    progressLabel,
    scannedRoot,
    scan,
    browse,
    effectiveRoot,
    fileResults,
    brokenLinks,
    dupFolders,
    simImages,
    cacheItems,
    repos,
    selectedPaths,
    setSelectedPaths,
    onTrash
  }
}

/** Controls row content for the subbar, identical in shape to every tab. */
export function FinderControls({ scan, onOpenCompare }: { scan: FinderScan; onOpenCompare: () => void }) {
  const homePath = useMetaStore((s) => s.homePath)
  const { tab, busy, progressLabel, effectiveRoot, scan: runScan, browse } = scan
  return (
    <>
      <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={browse} disabled={busy}>
        <SearchIcon className="size-3.5" />
        <span className="max-w-56 truncate">{shortenHome(effectiveRoot, homePath)}</span>
      </Button>
      <ToolbarLabel>{TAB_HINTS[tab]}</ToolbarLabel>
      <ToolbarSpacer />
      {tab === 'dup-folders' ? (
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onOpenCompare} disabled={busy}>
          <Folders className="size-3.5" /> Compare two folders…
        </Button>
      ) : null}
      <Button size="sm" className="h-7" onClick={runScan} disabled={busy}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <TabIcon tab={tab} />}
        Scan
      </Button>
      {busy && progressLabel ? (
        <span className="w-28 shrink-0 text-right font-mono text-[10px] text-muted-foreground">{progressLabel}</span>
      ) : null}
    </>
  )
}

/** Results area for finder tabs, below the subbar. */
export function FinderResults({ scan }: { scan: FinderScan }) {
  const homePath = useMetaStore((s) => s.homePath)
  const {
    tab,
    busy,
    progressLabel,
    scannedRoot,
    fileResults,
    brokenLinks,
    dupFolders,
    simImages,
    cacheItems,
    repos,
    selectedPaths
  } = scan
  const [trashDialog, setTrashDialog] = useState<Array<{ path: string; size: number }> | null>(null)
  const [statusRepo, setStatusRepo] = useState<RepoInfo | null>(null)

  const selectToggle = (path: string, checked: boolean): void => {
    scan.setSelectedPaths((current) => {
      const next = new Set(current)
      if (checked) next.add(path)
      else next.delete(path)
      return next
    })
  }

  const selectedCount = selectedPaths.size

  const collect = (): string[] => {
    if (FILE_TABS.includes(tab))
      return fileResults.filter((f) => selectedPaths.has(f.path)).map((f) => f.path)
    if (tab === 'broken-links') return brokenLinks.filter((l) => selectedPaths.has(l.path)).map((l) => l.path)
    if (tab === 'dup-folders') return dupFolders.flatMap((g) => g.paths).filter((p) => selectedPaths.has(p))
    if (tab === 'sim-images')
      return simImages.flatMap((g) => g.images.map((i) => i.path)).filter((p) => selectedPaths.has(p))
    if (tab === 'cache') return cacheItems.filter((c) => selectedPaths.has(c.path)).map((c) => c.path)
    return []
  }

  const fileMenus = (entry: FileEntry): TableMenuItem[] => [
    { label: 'Reveal in Finder', onSelect: () => void unwrap(tidy().revealInFinder(entry.path)).catch(() => {}) },
    { label: 'Open in Terminal', onSelect: () => void unwrap(tidy().openInTerminal(entry.path)).catch(() => {}) },
    {
      label: 'Move to Trash',
      destructive: true,
      onSelect: () => setTrashDialog([{ path: entry.path, size: entry.size }])
    }
  ]

  const empty = (
    <EmptyState
      icon={TabIconComponent[tab]}
      title={scannedRoot ? `No ${TAB_TITLES[tab].toLowerCase()} found` : TAB_HINTS[tab]}
      description={scannedRoot ? `Scanned ${shortenHome(scannedRoot, homePath)}.` : 'Choose a folder and scan.'}
    />
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {busy ? (
        <div className="border-b border-border px-4 py-2">
          <Progress value={14} className="h-1" />
        </div>
      ) : null}

      {FILE_TABS.includes(tab) ? (
        <FileTable
          ariaLabel={TAB_TITLES[tab]}
          entries={fileResults}
          selectedPaths={selectedPaths}
          onRowClick={(entry, _index, event) =>
            scan.setSelectedPaths((current) => {
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
          buildMenu={fileMenus}
          onPreview={(entry) => void unwrap(tidy().previewFile(entry.path)).catch(() => {})}
          showPath
          emptyState={empty}
        />
      ) : busy ? (
        <p className="flex items-center gap-2 px-4 py-8 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> {progressLabel ?? 'Scanning…'}
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {tab === 'broken-links' ? (
            brokenLinks.length === 0 ? (
              empty
            ) : (
              <FinderListShell>
                {brokenLinks.map((link) => (
                  <FinderListRow
                    key={link.path}
                    checked={selectedPaths.has(link.path)}
                    onCheck={(checked) => selectToggle(link.path, checked)}
                    path={link.path}
                    name={baseName(link.path)}
                    icon={<Link2Off className="size-4 text-destructive/70" />}
                    meta={`→ ${link.target}`}
                  />
                ))}
              </FinderListShell>
            )
          ) : tab === 'cache' ? (
            cacheItems.length === 0 ? (
              empty
            ) : (
              <div>
                <TrashBar count={selectedCount} onClick={() => setTrashDialog(collect().map((p) => ({ path: p, size: 0 })))} />
                <FinderListShell>
                  {cacheItems.map((item) => (
                    <FinderListRow
                      key={item.path}
                      checked={selectedPaths.has(item.path)}
                      onCheck={(checked) => selectToggle(item.path, checked)}
                      path={item.path}
                      name={item.name}
                      icon={<Package className="size-4 text-muted-foreground" />}
                      meta={formatBytes(item.bytes) + (item.truncated ? '+' : '')}
                    />
                  ))}
                </FinderListShell>
              </div>
            )
          ) : tab === 'dup-folders' ? (
            dupFolders.length === 0 ? (
              empty
            ) : (
              <div className="space-y-3">
                <TrashBar count={selectedCount} onClick={() => setTrashDialog(collect().map((p) => ({ path: p, size: 0 })))} />
                {dupFolders.map((group, index) => (
                  <div key={index} className="overflow-hidden rounded-lg border border-border">
                    <div className="border-b border-border/60 bg-muted/40 px-3 py-2 text-xs">
                      <span className="font-medium">{group.paths.length} identical folders</span>
                      <span className="text-muted-foreground">
                        {' '}
                        · {group.fileCount} files each · {formatBytes(group.bytes)} each
                      </span>
                    </div>
                    {group.paths.map((p) => (
                      <div
                        key={p}
                        className="flex items-center gap-2.5 border-b border-border/40 px-3 py-1.5 text-xs last:border-b-0"
                      >
                        <input
                          type="checkbox"
                          checked={selectedPaths.has(p)}
                          onChange={(e) => selectToggle(p, e.target.checked)}
                          aria-label={`Select ${p}`}
                        />
                        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={p}>
                          {p}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-[11px]"
                          onClick={() => void unwrap(tidy().revealInFinder(p)).catch(() => {})}
                        >
                          Reveal
                        </Button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )
          ) : tab === 'sim-images' ? (
            simImages.length === 0 ? (
              empty
            ) : (
              <div className="space-y-3">
                <TrashBar count={selectedCount} onClick={() => setTrashDialog(collect().map((p) => ({ path: p, size: 0 })))} />
                {simImages.map((group, index) => (
                  <div key={index} className="overflow-hidden rounded-lg border border-border">
                    <div className="border-b border-border/60 bg-muted/40 px-3 py-2 text-xs">
                      <span className="font-medium">{group.images.length} visually similar</span>
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground">{group.hash.slice(0, 10)}</span>
                    </div>
                    {group.images.map((image) => (
                      <div
                        key={image.path}
                        className="flex items-center gap-2.5 border-b border-border/40 px-3 py-1.5 text-xs last:border-b-0"
                      >
                        <input
                          type="checkbox"
                          checked={selectedPaths.has(image.path)}
                          onChange={(e) => selectToggle(image.path, e.target.checked)}
                          aria-label={`Select ${image.path}`}
                        />
                        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={image.path}>
                          {image.path}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{formatBytes(image.size)}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-[11px]"
                          onClick={() => void unwrap(tidy().previewFile(image.path)).catch(() => {})}
                        >
                          Look
                        </Button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )
          ) : repos.length === 0 ? (
            empty
          ) : (
            <div className="space-y-2.5">
              {repos.map((repo) => (
                <div key={repo.path} className="rounded-lg border border-border px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium" title={repo.path}>
                      {repo.name}
                    </span>
                    <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                      {repo.branch || '—'}
                    </span>
                    {repo.modified > 0 || repo.untracked > 0 ? (
                      <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                        {repo.modified} changed · {repo.untracked} untracked
                      </span>
                    ) : (
                      <span className="shrink-0 text-[11px] text-emerald-600 dark:text-emerald-400">clean</span>
                    )}
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatBytes(repo.gitBytes)}
                    </span>
                  </div>
                  {repo.lastCommit ? (
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">{repo.lastCommit}</p>
                  ) : null}
                  <div className="mt-2 flex gap-1.5">
                    <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setStatusRepo(repo)}>
                      Status
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => void unwrap(tidy().openInTerminal(repo.path)).catch(() => {})}
                    >
                      Terminal
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => void unwrap(tidy().revealInFinder(repo.path)).catch(() => {})}
                    >
                      Reveal
                    </Button>
                  </div>
                </div>
              ))}
              {scannedRoot ? (
                <p className="px-1 pb-2 text-[11px] text-muted-foreground">
                  Scanned {shortenHome(scannedRoot, homePath)}
                </p>
              ) : null}
            </div>
          )}
        </div>
      )}

      {trashDialog ? (
        <TrashConfirmDialog
          items={trashDialog}
          onClose={(trashed) => {
            const items = trashDialog
            setTrashDialog(null)
            if (trashed) scan.onTrash(items.map((i) => i.path))
          }}
        />
      ) : null}
      {statusRepo ? <GitStatusDialog repo={statusRepo} onClose={() => setStatusRepo(null)} /> : null}
    </div>
  )
}

function TrashBar({ count, onClick }: { count: number; onClick: () => void }) {
  if (count === 0) return null
  return (
    <Button variant="destructive" size="sm" className="mb-3 gap-1.5" onClick={onClick}>
      <Trash2 className="size-3.5" /> Trash {count} selected
    </Button>
  )
}

/** One uniform row anatomy shared by every custom finder list. */
export function FinderListRow({
  path,
  name,
  icon,
  meta,
  checked,
  onCheck
}: {
  path: string
  name: string
  icon: React.ReactNode
  meta?: string
  checked: boolean
  onCheck: (checked: boolean) => void
}) {
  return (
    <li
      className={cn(
        'flex items-center gap-2.5 border-b border-border/40 px-3 py-2 text-[13px] last:border-b-0',
        checked && 'bg-primary/[0.06]'
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheck(e.target.checked)}
        aria-label={`Select ${path}`}
      />
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="w-44 shrink-0 truncate font-medium" title={name}>
        {name}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={path}>
        {path}
      </span>
      {meta ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{meta}</span> : null}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 px-2 text-[11px]"
        onClick={() => void unwrap(tidy().revealInFinder(path)).catch(() => {})}
      >
        Reveal
      </Button>
    </li>
  )
}

export function FinderListShell({ children }: { children: React.ReactNode }) {
  return <ul className="overflow-hidden rounded-lg border border-border">{children}</ul>
}

const TabIconComponent: Record<FinderTab, typeof FileQuestion> = {
  'empty-files': FileQuestion,
  'broken-links': Link2Off,
  'temp-files': FileQuestion,
  'old-installers': Disc3,
  'dup-folders': Folders,
  'sim-images': Image,
  cache: Package,
  git: GitBranch
}

function TabIcon({ tab }: { tab: FinderTab }) {
  switch (tab) {
    case 'empty-files':
      return <FileQuestion className="size-3.5" />
    case 'broken-links':
      return <Link2Off className="size-3.5" />
    case 'temp-files':
      return <FileQuestion className="size-3.5" />
    case 'old-installers':
      return <Disc3 className="size-3.5" />
    case 'dup-folders':
      return <Folders className="size-3.5" />
    case 'sim-images':
      return <Image className="size-3.5" />
    case 'cache':
      return <Package className="size-3.5" />
    case 'git':
      return <GitBranch className="size-3.5" />
  }
}
