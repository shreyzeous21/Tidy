import { useEffect, useMemo, useState } from 'react'
import { Loader2, Package, Link2Off, FileQuestion, Disc3, Folders, Image, GitBranch, Eye, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FileTable } from '@/components/files/FileTable'
import type { TableMenuItem } from '@/components/files/FileTable'
import { TrashConfirmDialog } from '@/components/dialogs/TrashConfirmDialog'
import { GitStatusDialog } from '@/components/dialogs/ToolDialogs'
import { EmptyState } from '@/components/common/EmptyState'
import { tidy, unwrap, messageOf } from '@/lib/api'
import { formatBytes, shortenHome } from '@/lib/format'
import { useMetaStore } from '@/stores/browser-store'
import type { FileEntry } from '@shared/types/files'
import type {
  BrokenLink,
  CacheItem,
  DuplicateFolderGroup,
  RepoInfo,
  SimilarImageGroup
} from '@shared/types/cleanup'

/**
 * Hosts the second wave of Clean Up finders (empty files, broken links,
 * temp files, old installers, duplicate folders, similar images, caches,
 * git repos + folder compare). Each tab scans on demand with progress and
 * cancellation; trashing always goes through the confirmation dialog.
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

const TAB_META: Record<FinderTab, { label: string; hint: string }> = {
  'empty-files': { label: 'Empty files', hint: 'Zero-byte files' },
  'broken-links': { label: 'Broken links', hint: 'Symlinks to missing targets' },
  'temp-files': { label: 'Temp files', hint: 'Leftover .tmp/.part/~$/.DS_Store patterns' },
  'old-installers': { label: 'Old installers', hint: 'DMG/PKG/ISO untouched 30+ days' },
  'dup-folders': { label: 'Dup folders', hint: 'Byte-identical folder trees (hash-verified)' },
  'sim-images': { label: 'Similar images', hint: 'Perceptual dHash grouping' },
  cache: { label: 'Caches', hint: 'Top-level cache folders by size' },
  git: { label: 'Git repos', hint: 'Repositories with status + .git size' }
}

const FILE_TABS: FinderTab[] = ['empty-files', 'temp-files', 'old-installers']
export const FINDER_TABS: FinderTab[] = [
  'empty-files', 'broken-links', 'temp-files', 'old-installers',
  'dup-folders', 'sim-images', 'cache', 'git'
]

export function FindersView({ tab, onOpenCompare }: { tab: FinderTab; onOpenCompare: () => void }) {
  const homePath = useMetaStore((s) => s.homePath)
  const [root, setRoot] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progressLabel, setProgressLabel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scannedRoot, setScannedRoot] = useState<string | null>(null)

  const [fileResults, setFileResults] = useState<FileEntry[]>([])
  const [brokenLinks, setBrokenLinks] = useState<BrokenLink[]>([])
  const [dupFolders, setDupFolders] = useState<DuplicateFolderGroup[]>([])
  const [simImages, setSimImages] = useState<SimilarImageGroup[]>([])
  const [cacheItems, setCacheItems] = useState<CacheItem[]>([])
  const [repos, setRepos] = useState<RepoInfo[]>([])
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(new Set())
  const [trashDialog, setTrashDialog] = useState<Array<{ path: string; size: number }> | null>(null)
  const [statusRepo, setStatusRepo] = useState<RepoInfo | null>(null)

  const effectiveRoot = tab === 'cache' ? `${homePath === '/' ? '' : homePath}/Library/Caches` : (root ?? homePath)

  useEffect(() => {
    return tidy().onScanProgress((p) => {
      setProgressLabel(
        p.phase === 'done' ? null : `${p.processed.toLocaleString()}${p.total ? ` / ${p.total.toLocaleString()}` : ''}`
      )
    })
  }, [])

  const browse = async (): Promise<void> => {
    try {
      const picked = await unwrap(tidy().pickFolder('Choose a folder to scan'))
      if (picked) setRoot(picked)
    } catch (error) {
      toast.error(messageOf(error))
    }
  }

  const scan = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setSelectedPaths(new Set())
    setProgressLabel('…')
    try {
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
    } catch (cause) {
      setError(messageOf(cause))
      toast.error(messageOf(cause))
    } finally {
      setBusy(false)
      setProgressLabel(null)
    }
  }

  const reconcile = (removed: string[]): void => {
    const removedSet = new Set(removed)
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

  const totalReclaim = useMemo(() => {
    if (tab === 'dup-folders') {
      return dupFolders.reduce((sum, g) => sum + g.bytes * (g.paths.length - 1), 0)
    }
    if (tab === 'cache') return cacheItems.reduce((sum, c) => sum + c.bytes, 0)
    return fileResults.reduce((sum, f) => sum + f.size, 0)
  }, [tab, dupFolders, cacheItems, fileResults])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        {tab !== 'cache' ? (
          <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => void browse()} disabled={busy}>
            <Eye className="size-3.5" />
            <span className="max-w-52 truncate">{shortenHome(effectiveRoot, homePath)}</span>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">{shortenHome(effectiveRoot, homePath)}</span>
        )}
        <Button size="sm" onClick={() => void scan()} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FinderIcon tab={tab} />}
          Scan
        </Button>
        {busy && progressLabel ? (
          <span className="text-[11px] text-muted-foreground">{progressLabel}</span>
        ) : null}
        {tab === 'dup-folders' ? (
          <Button size="sm" variant="outline" onClick={onOpenCompare} disabled={busy}>
            <Folders className="size-3.5" /> Compare two folders…
          </Button>
        ) : null}
        <div className="flex-1" />
        {scannedRoot && totalReclaim > 0 ? (
          <span className="text-xs text-muted-foreground">
            {formatBytes(totalReclaim)} found in {shortenHome(scannedRoot, homePath)}
          </span>
        ) : null}
        {((FILE_TABS.includes(tab) && selectedPaths.size > 0) ||
          (tab === 'dup-folders' && selectedPaths.size > 0) ||
          (tab === 'cache' && selectedPaths.size > 0) ||
          (tab === 'broken-links' && selectedPaths.size > 0)) && !busy ? (
          <Button
            variant="destructive"
            size="sm"
            className="gap-1.5"
            onClick={() =>
              setTrashDialog(
                (tab === 'dup-folders'
                  ? dupFolders.flatMap((g) => g.paths)
                  : tab === 'broken-links'
                    ? brokenLinks.map((l) => l.path)
                    : tab === 'cache'
                      ? cacheItems.map((c) => c.path)
                      : fileResults.filter((f) => selectedPaths.has(f.path)).map((f) => f.path)
                )
                  .filter((p) => selectedPaths.has(p))
                  .map((p) => ({ path: p, size: 0 }))
              )
            }
          >
            <Trash2 className="size-3.5" />
            Trash selected ({selectedPaths.size})
          </Button>
        ) : null}
      </div>

      {error ? <p className="px-4 py-2 text-xs text-destructive">{error}</p> : null}

      {busy ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {TAB_META[tab].hint}…
        </div>
      ) : (
        <FinderResults
          tab={tab}
          scannedRoot={scannedRoot}
          fileResults={fileResults}
          brokenLinks={brokenLinks}
          dupFolders={dupFolders}
          simImages={simImages}
          cacheItems={cacheItems}
          repos={repos}
          selectedPaths={selectedPaths}
          setSelectedPaths={setSelectedPaths}
          fileMenus={fileMenus}
          setStatusRepo={setStatusRepo}
          homePath={homePath}
        />
      )}

      {trashDialog ? (
        <TrashConfirmDialog
          items={trashDialog}
          onClose={(trashed) => {
            const items = trashDialog
            setTrashDialog(null)
            if (trashed) reconcile(items.map((i) => i.path))
          }}
        />
      ) : null}
      {statusRepo ? <GitStatusDialog repo={statusRepo} onClose={() => setStatusRepo(null)} /> : null}
    </div>
  )
}

function FinderIcon({ tab }: { tab: FinderTab }) {
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
      return <Trash2 className="size-3.5" />
    case 'git':
      return <GitBranch className="size-3.5" />
  }
}

function FinderResults({
  tab,
  scannedRoot,
  fileResults,
  brokenLinks,
  dupFolders,
  simImages,
  cacheItems,
  repos,
  selectedPaths,
  setSelectedPaths,
  fileMenus,
  setStatusRepo,
  homePath
}: {
  tab: FinderTab
  scannedRoot: string | null
  fileResults: FileEntry[]
  brokenLinks: BrokenLink[]
  dupFolders: DuplicateFolderGroup[]
  simImages: SimilarImageGroup[]
  cacheItems: CacheItem[]
  repos: RepoInfo[]
  selectedPaths: ReadonlySet<string>
  setSelectedPaths: (updater: (current: ReadonlySet<string>) => ReadonlySet<string>) => void
  fileMenus: (entry: FileEntry) => TableMenuItem[]
  setStatusRepo: (repo: RepoInfo | null) => void
  homePath: string
}) {
  const fileName = scannedRoot ? `No ${TAB_META[tab].label.toLowerCase()} in ${shortenHome(scannedRoot, homePath)}` : TAB_META[tab].hint

  if (FILE_TABS.includes(tab)) {
    return (
      <FileTable
        ariaLabel={TAB_META[tab].label}
        entries={fileResults}
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
        buildMenu={fileMenus}
        onPreview={(entry) => void unwrap(tidy().previewFile(entry.path)).catch(() => {})}
        showPath
        emptyState={<EmptyState icon={Package} title={scannedRoot ? fileName : 'Scan a folder first'} description={TAB_META[tab].hint} />}
      />
    )
  }

  if (tab === 'broken-links') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        {brokenLinks.length === 0 ? (
          <EmptyState icon={Link2Off} title={scannedRoot ? 'No broken symlinks' : 'Scan a folder first'} description="Symlinks whose target has disappeared." />
        ) : (
          <ul className="p-3 text-xs">
            {brokenLinks.map((link) => (
              <li key={link.path} className="flex items-center gap-2.5 border-b border-border/40 py-1.5 last:border-b-0">
                <input
                  type="checkbox"
                  checked={selectedPaths.has(link.path)}
                  onChange={(event) =>
                    setSelectedPaths((current) => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(link.path)
                      else next.delete(link.path)
                      return next
                    })
                  }
                  aria-label={`Select ${link.path}`}
                />
                <Link2Off className="size-3.5 shrink-0 text-destructive/70" />
                <span className="min-w-0 flex-1 truncate" title={link.path}>{link.path}</span>
                <span className="w-48 shrink-0 truncate text-muted-foreground" title={link.target}>→ {link.target}</span>
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => void unwrap(tidy().revealInFinder(link.path)).catch(() => {})}>
                  Reveal
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  if (tab === 'dup-folders') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        {dupFolders.length === 0 ? (
          <EmptyState icon={Folders} title={scannedRoot ? 'No duplicate folders' : 'Scan a folder first'} description="Folders with identical contents (paths and head hashes match) are grouped — pick which copies to keep." />
        ) : (
          <ul className="space-y-3 p-3">
            {dupFolders.map((group, groupIndex) => (
              <li key={groupIndex} className="rounded-lg border border-border">
                <div className="border-b border-border/60 px-3 py-2 text-xs">
                  <span className="font-medium">{group.paths.length} identical folders</span>
                  <span className="text-muted-foreground"> · {group.fileCount} files each · {formatBytes(group.bytes)} each</span>
                </div>
                {group.paths.map((p) => (
                  <div key={p} className="flex items-center gap-2.5 px-3 py-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={selectedPaths.has(p)}
                      onChange={(event) =>
                        setSelectedPaths((current) => {
                          const next = new Set(current)
                          if (event.target.checked) next.add(p)
                          else next.delete(p)
                          return next
                        })
                      }
                      aria-label={`Select ${p}`}
                    />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground" title={p}>{p}</span>
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => void unwrap(tidy().revealInFinder(p)).catch(() => {})}>
                      Reveal
                    </Button>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  if (tab === 'sim-images') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        {simImages.length === 0 ? (
          <EmptyState icon={Image} title={scannedRoot ? 'No similar images' : 'Scan a folder first'} description="Resized or edited copies of the same photo are grouped by perceptual hash." />
        ) : (
          <ul className="space-y-3 p-3">
            {simImages.map((group, groupIndex) => (
              <li key={groupIndex} className="rounded-lg border border-border px-3 py-2">
                <p className="mb-1.5 text-xs font-medium">
                  {group.images.length} visually similar · font-mono text-[11px] text-muted-foreground {group.hash.slice(0, 10)}
                </p>
                {group.images.map((image) => (
                  <div key={image.path} className="flex items-center gap-2.5 py-0.5 text-xs">
                    <input
                      type="checkbox"
                      checked={selectedPaths.has(image.path)}
                      onChange={(event) =>
                        setSelectedPaths((current) => {
                          const next = new Set(current)
                          if (event.target.checked) next.add(image.path)
                          else next.delete(image.path)
                          return next
                        })
                      }
                      aria-label={`Select ${image.path}`}
                    />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground" title={image.path}>{image.path}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{formatBytes(image.size)}</span>
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => void unwrap(tidy().previewFile(image.path)).catch(() => {})}>
                      Look
                    </Button>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  if (tab === 'cache') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        {cacheItems.length === 0 ? (
          <EmptyState icon={Trash2} title={scannedRoot ? 'No cache folders' : 'Scan a folder first'} description="Top-level cache folders with sizes — review before trashing; caches rebuild automatically." />
        ) : (
          <ul className="p-3 text-xs">
            {cacheItems.map((item) => (
              <li key={item.path} className="flex items-center gap-2.5 border-b border-border/40 py-1.5 last:border-b-0">
                <input
                  type="checkbox"
                  checked={selectedPaths.has(item.path)}
                  onChange={(event) =>
                    setSelectedPaths((current) => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(item.path)
                      else next.delete(item.path)
                      return next
                    })
                  }
                  aria-label={`Select ${item.path}`}
                />
                <span className="w-56 shrink-0 truncate font-medium" title={item.name}>{item.name}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground" title={item.path}>{item.path}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatBytes(item.bytes)}
                  {item.truncated ? '+' : ''}
                </span>
                <Button variant="ghost" size="sm" className="h-6 shrink-0 px-1.5 text-[11px]" onClick={() => void unwrap(tidy().revealInFinder(item.path)).catch(() => {})}>
                  Reveal
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  // git
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {repos.length === 0 ? (
        <EmptyState icon={GitBranch} title={scannedRoot ? 'No repositories found' : 'Scan a folder first'} description="Finds .git repositories, shows branch, uncommitted counts, last commit, and .git size." />
      ) : (
        <ul className="p-3">
          {repos.map((repo) => (
            <li key={repo.path} className="mb-2 rounded-lg border border-border px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium" title={repo.path}>{repo.name}</span>
                <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">{repo.branch || '—'}</span>
                {repo.modified > 0 || repo.untracked > 0 ? (
                  <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                    {repo.modified} changed · {repo.untracked} untracked
                  </span>
                ) : (
                  <span className="shrink-0 text-[11px] text-emerald-600 dark:text-emerald-400">clean</span>
                )}
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatBytes(repo.gitBytes)}</span>
              </div>
              {repo.lastCommit ? <p className="mt-1 truncate text-[11px] text-muted-foreground">{repo.lastCommit}</p> : null}
              <div className="mt-1.5 flex gap-1.5">
                <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={() => setStatusRepo(repo)}>
                  Status
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px]"
                  onClick={() => void unwrap(tidy().openInTerminal(repo.path)).catch(() => {})}
                >
                  Terminal
                </Button>
                <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => void unwrap(tidy().revealInFinder(repo.path)).catch(() => {})}>
                  Reveal
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

