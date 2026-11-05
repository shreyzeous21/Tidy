import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, HardDrive, Clock, Loader2, Image as ImageIcon, History } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Undo2 } from 'lucide-react'
import { FileIcon } from '@/components/common/FileIcon'
import { EmptyState, PermissionNotice } from '@/components/common/EmptyState'
import { ToolbarLabel, ToolbarSpacer, ViewToolbar } from '@/components/common/ViewToolbar'
import { tidy, unwrap, messageOf, codeOf } from '@/lib/api'
import { formatBytes, formatDate, formatRelative, shortenHome } from '@/lib/format'
import { useAppStore } from '@/stores/app-store'
import { useBrowserStore, useMetaStore } from '@/stores/browser-store'
import type { FileEntry, FolderInfo } from '@shared/types/files'
import type { OperationHistoryItem } from '@shared/types/settings'

interface HistoryRow extends OperationHistoryItem {
  undoable?: boolean
  undone?: boolean
}

const QUICK_FOLDER_IDS = ['desktop', 'documents', 'downloads', 'pictures', 'music', 'movies']

export function HomeView() {
  const homeFolders = useMetaStore((s) => s.homeFolders)
  const homePath = useMetaStore((s) => s.homePath)
  const appInfo = useMetaStore((s) => s.appInfo)
  const setView = useAppStore((s) => s.setView)
  const navigate = useBrowserStore((s) => s.navigate)

  const [history, setHistory] = useState<HistoryRow[]>([])
  const [recentFiles, setRecentFiles] = useState<FileEntry[]>([])
  const [permissionIssues, setPermissionIssues] = useState<string[]>([])
  const [loadingRecent, setLoadingRecent] = useState(true)

  const refreshHistory = (): void => {
    void unwrap(tidy().getHistory())
      .then(setHistory)
      .catch(() => {})
  }
  useEffect(() => {
    refreshHistory()
  }, [])
  const undoOperation = (id: string): void => {
    void unwrap(tidy().undoOperation(id))
      .then(() => {
        toast.success('Operation undone')
        refreshHistory()
      })
      .catch((cause) => toast.error(messageOf(cause)))
  }

  // Recently modified: honest scope — top level of the quick-access folders only.
  useEffect(() => {
    if (homeFolders.length === 0) return
    let cancelled = false
    // Intentional fetch-on-mount flag.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingRecent(true)
    const targets = homeFolders.filter((f) => QUICK_FOLDER_IDS.includes(f.id)).slice(0, 4)
    const issues: string[] = []
    void Promise.all(
      targets.map((folder) =>
        unwrap(tidy().listDirectory(folder.path)).catch((cause) => {
          if (codeOf(cause) === 'PERMISSION_DENIED') issues.push(folder.name)
          return { entries: [] as FileEntry[] }
        })
      )
    ).then((listings) => {
      if (cancelled) return
      const merged = listings
        .flatMap((l) => l.entries)
        .filter((e) => !e.isDirectory)
        .sort((a, b) => b.modifiedAt - a.modifiedAt)
        .slice(0, 8)
      setRecentFiles(merged)
      setPermissionIssues(issues)
      setLoadingRecent(false)
    })
    return () => {
      cancelled = true
    }
  }, [homeFolders])

  const quickFolders = useMemo(
    () => homeFolders.filter((f) => QUICK_FOLDER_IDS.includes(f.id)),
    [homeFolders]
  )

  // External drives: fetched once, refreshed on mount/unmount events.
  const volumes = useMetaStore((s) => s.volumes)
  const setVolumes = useMetaStore((s) => s.setVolumes)
  useEffect(() => {
    void unwrap(tidy().listVolumes())
      .then(setVolumes)
      .catch(() => {})
    return tidy().onVolumesChanged(() => {
      void unwrap(tidy().listVolumes())
        .then(setVolumes)
        .catch(() => {})
    })
  }, [setVolumes])

  const openInFiles = (folder: FolderInfo): void => {
    navigate(folder.path)
    setView('files')
  }

  const openFile = (entry: FileEntry): void => {
    void unwrap(tidy().openPath(entry.path)).catch((cause) => toast.error(messageOf(cause)))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewToolbar>
        <ToolbarLabel title={homePath}>
          {homePath ? shortenHome(homePath, homePath) : '~'}
        </ToolbarLabel>
        <ToolbarSpacer />
      </ViewToolbar>

      <div className="min-h-0 w-full flex-1 space-y-7 overflow-y-auto px-4 py-4">
        <section>
          <h2 className="mb-2 text-[13px] font-semibold">Quick access</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {quickFolders.map((folder) => (
              <button
                key={folder.path}
                type="button"
                onClick={() => openInFiles(folder)}
                className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-left text-[13px] hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FolderOpen className="size-4 shrink-0 text-sky-500 dark:text-sky-400" />
                <span className="min-w-0 flex-1 truncate">{folder.name}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => openInFiles({ id: 'root', name: 'Macintosh HD', path: '/' })}
              className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-left text-[13px] hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
              title="Browse the entire system — reads work everywhere; changes stay in your home folder and folders you pick."
            >
              <HardDrive className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">Macintosh HD</span>
            </button>
            {volumes.map((volume) => (
              <button
                key={volume.path}
                type="button"
                onClick={() => openInFiles(volume)}
                className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-left text-[13px] hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
                title={volume.path}
              >
                <HardDrive className="size-4 shrink-0 text-amber-600/80 dark:text-amber-400/90" />
                <span className="min-w-0 flex-1 truncate">{volume.name}</span>
              </button>
            ))}
          </div>
        </section>

        {permissionIssues.length > 0 ? (
          <PermissionNotice
            message={`macOS blocked access to: ${permissionIssues.join(', ')}. Allow Tidy in System Settings → Privacy & Security → Files and Folders to include them here.`}
          />
        ) : null}

        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-[13px] font-semibold">Recently modified</h2>
            <span className="text-[11px] text-muted-foreground">
              Top level of quick-access folders
            </span>
          </div>
          {loadingRecent ? (
            <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Checking folders…
            </div>
          ) : recentFiles.length === 0 ? (
            <EmptyState
              icon={ImageIcon}
              title="Nothing recent"
              description="Files added or changed in your quick-access folders will show up here."
              className="py-8"
            />
          ) : (
            <ul className="overflow-hidden rounded-lg border border-border">
              {recentFiles.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    onClick={() => openFile(entry)}
                    className="flex w-full items-center gap-2.5 border-b border-border/50 px-3 py-2 text-left text-[13px] last:border-b-0 hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <FileIcon kind={entry.kind} />
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:block" title={entry.path}>
                      {shortenHome(entry.path.slice(0, entry.path.lastIndexOf('/')) || '/', homePath)}
                    </span>
                    <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                      {entry.size ? formatBytes(entry.size) : ''}
                    </span>
                    <span className="w-24 shrink-0 text-right text-[11px] text-muted-foreground">
                      {formatDate(entry.modifiedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
              <History className="size-3.5 text-muted-foreground" />
              Recent activity in Tidy
            </h2>
            <span className="text-[11px] text-muted-foreground">Actions recorded by this app only</span>
          </div>
          {history.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="No activity yet"
              description="Renames, moves, and trashes you perform in Tidy are listed here."
              className="py-8"
            />
          ) : (
            <ul className="overflow-hidden rounded-lg border border-border">
              {history.slice(0, 8).map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2.5 border-b border-border/50 px-3 py-2 text-xs last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate">{item.summary}</span>
                  {'undoable' in item && item.undoable ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-1.5 text-[11px]"
                      onClick={() => undoOperation(item.id)}
                    >
                      <Undo2 className="size-3" /> Undo
                    </Button>
                  ) : null}
                  <span className="shrink-0 text-[11px] capitalize text-muted-foreground">{item.type}</span>
                  <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground">
                    {formatRelative(item.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {appInfo ? (
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/70">
              Tidy can’t see files you open outside the app — activity above covers renames, moves, and
              trashes performed in Tidy (v{appInfo.versions.app}).
            </p>
          ) : null}
        </section>
      </div>
    </div>
  )
}
