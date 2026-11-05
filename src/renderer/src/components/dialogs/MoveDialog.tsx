import { useCallback, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FileText, FolderOpen, House, Image as Picture, Download, Clock, Plus, CircleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { tidy, unwrap } from '@/lib/api'
import { baseName, shortenHome } from '@/lib/format'
import { useAppStore } from '@/stores/app-store'
import { useMetaStore } from '@/stores/browser-store'
import type { MoveConflict, MoveItemResult, ConflictPolicy, FolderInfo } from '@shared/types/files'

interface MoveDialogProps {
  paths: string[]
  /** When set, the destination chooser is skipped (drag-drop target). */
  presetDestination?: string | null
  /** 'copy' keeps the sources in place ("Copy to…"); 'move' is the default. */
  mode?: 'move' | 'copy'
  onClose: (movedAny: boolean) => void
}

type Step = 'dest' | 'review' | 'done'

const POLICY_LABELS: Record<ConflictPolicy, string> = {
  skip: 'Skip conflicting items',
  replace: 'Replace existing files',
  'keep-both': 'Keep both (add “(2)” to the name)'
}

/** Shared per-item results block (also used by Downloads organizing). */
export function MoveResultsSummary({ results }: { results: MoveItemResult[] }) {
  const counts = useMemo(() => {
    const c = { moved: 0, replaced: 0, renamed: 0, skipped: 0, failed: 0 }
    for (const r of results) c[r.status]++
    return c
  }, [results])
  const failed = results.filter((r) => r.status === 'failed')

  return (
    <div className="space-y-2 text-xs">
      <p>
        <span className="text-emerald-600 dark:text-emerald-400">{counts.moved + counts.replaced + counts.renamed} moved</span>
        {counts.skipped > 0 ? <span> · {counts.skipped} skipped</span> : null}
        {counts.failed > 0 ? (
          <span className="text-destructive"> · {counts.failed} failed</span>
        ) : null}
      </p>
      {failed.length > 0 ? (
        <ul className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-border bg-muted/40 p-2">
          {failed.slice(0, 6).map((r) => (
            <li key={r.sourcePath} className="flex items-start gap-1.5">
              <CircleAlert className="mt-0.5 size-3 shrink-0 text-destructive" />
              <span className="min-w-0">
                <span className="font-medium">{baseName(r.sourcePath)}</span>
                <span className="text-muted-foreground"> — {r.error?.message ?? 'failed'}</span>
              </span>
            </li>
          ))}
          {failed.length > 6 ? <li className="text-muted-foreground">…and {failed.length - 6} more</li> : null}
        </ul>
      ) : null}
    </div>
  )
}

export function MoveDialog({ paths, presetDestination, mode = 'move', onClose }: MoveDialogProps) {
  const settings = useAppStore((s) => s.settings)
  const loadSettings = useAppStore((s) => s.loadSettings)
  const homePath = useMetaStore((s) => s.homePath)
  const homeFolders = useMetaStore((s) => s.homeFolders)
  const verb = mode === 'copy' ? 'Copy' : 'Move'
  const pastVerb = mode === 'copy' ? 'copied' : 'moved'

  const [step, setStep] = useState<Step>(presetDestination ? 'review' : 'dest')
  const [destination, setDestination] = useState<string | null>(presetDestination ?? null)
  const [conflicts, setConflicts] = useState<MoveConflict[]>([])
  const [policy, setPolicy] = useState<ConflictPolicy>('skip')
  const [results, setResults] = useState<MoveItemResult[] | null>(null)
  const [busy, setBusy] = useState(false)

  const movedAnySoFar = useCallback(
    (list: MoveItemResult[]) => list.some((r) => r.status === 'moved' || r.status === 'replaced' || r.status === 'renamed'),
    []
  )

  const chooseDestination = async (dest: string): Promise<void> => {
    setBusy(true)
    try {
      const found = await unwrap(tidy().checkMoveConflicts(paths, dest))
      setDestination(dest)
      setConflicts(found)
      setStep('review')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not inspect the destination.')
    } finally {
      setBusy(false)
    }
  }

  const pickFolderFlow = async (): Promise<void> => {
    try {
      const picked = await unwrap(tidy().pickFolder('Choose a destination folder'))
      if (picked) await chooseDestination(picked)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open the folder picker.')
    }
  }

  const execute = async (retryPaths?: string[]): Promise<void> => {
    if (!destination) return
    const targets = retryPaths ?? paths
    setBusy(true)
    try {
      const moveResults =
        mode === 'copy'
          ? await unwrap(tidy().copyItems(targets, destination, policy))
          : await unwrap(tidy().moveItems(targets, destination, policy))
      // Merge retries into the cumulative result view.
      const byPath = new Map((results ?? []).map((r) => [r.sourcePath, r]))
      for (const r of moveResults) byPath.set(r.sourcePath, r)
      const merged = [...byPath.values()]
      setResults(merged)
      setStep('done')
      const anyMoved = movedAnySoFar(moveResults)
      if (anyMoved) {
        const count = moveResults.filter((r) => r.status !== 'skipped' && r.status !== 'failed').length
        toast.success(count === 1 ? `Item ${pastVerb}` : `${count} items ${pastVerb}`)
        void loadSettings() // refresh recent destinations
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `The ${mode} could not be completed.`)
    } finally {
      setBusy(false)
    }
  }

  const quickFoldersWithIcons: Array<{ icon: React.ReactNode; folder: FolderInfo }> = homeFolders.map((f) => ({
    folder: f,
    icon:
      f.id === 'desktop' ? <House className="size-4" /> :
      f.id === 'downloads' ? <Download className="size-4" /> :
      f.id === 'pictures' ? <Picture className="size-4" /> :
      <FileText className="size-4" />
  }))

  const pinned = settings?.pinnedFolders ?? []
  const recents = (settings?.recentDestinations ?? []).filter((r) => r !== destination)

  const failedPaths = (results ?? []).filter((r) => r.status === 'failed').map((r) => r.sourcePath)
  const movedCount = (results ?? []).filter((r) => r.status !== 'failed' && r.status !== 'skipped').length

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(movedCount > 0)}>
      <DialogContent className="max-w-lg">
        {step === 'dest' ? (
          <>
            <DialogHeader>
              <DialogTitle>{verb} {paths.length === 1 ? `“${baseName(paths[0])}”` : `${paths.length} items`}</DialogTitle>
              <DialogDescription>Choose where these items should go.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-3 gap-1.5">
              {quickFoldersWithIcons.map(({ folder, icon }) => (
                <button
                  key={folder.path}
                  type="button"
                  disabled={busy}
                  onClick={() => void chooseDestination(folder.path)}
                  className="flex flex-col items-center gap-1.5 rounded-md border border-border px-2 py-3 text-xs hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  {icon}
                  <span className="max-w-full truncate">{folder.name}</span>
                </button>
              ))}
            </div>
            {pinned.length > 0 ? (
              <DestinationList
                title="Pinned"
                paths={pinned}
                homePath={homePath}
                icon={<FolderOpen className="size-4 text-muted-foreground" />}
                onPick={(p) => void chooseDestination(p)}
                busy={busy}
              />
            ) : null}
            {recents.length > 0 ? (
              <DestinationList
                title="Recent destinations"
                paths={recents}
                homePath={homePath}
                icon={<Clock className="size-4 text-muted-foreground" />}
                onPick={(p) => void chooseDestination(p)}
                busy={busy}
              />
            ) : null}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onClose(false)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="outline" onClick={() => void pickFolderFlow()} disabled={busy}>
                <Plus className="size-4" /> Choose folder…
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {step === 'review' && destination ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {verb} {paths.length === 1 ? `“${baseName(paths[0])}”` : `${paths.length} items`}
              </DialogTitle>
              <DialogDescription>Into {shortenHome(destination, homePath)}</DialogDescription>
            </DialogHeader>
            {conflicts.length > 0 ? (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                  <CircleAlert className="size-3.5" />
                  {conflicts.length === 1
                    ? `“${conflicts[0].sourceName}” already exists at the destination`
                    : `${conflicts.length} items already exist at the destination`}
                </p>
                <ul className="max-h-28 overflow-y-auto rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                  {conflicts.slice(0, 5).map((c) => (
                    <li key={c.sourcePath} className="truncate py-0.5">
                      {c.sourceName}
                      {c.targetIsDirectory ? ' (folder — can’t be replaced)' : ''}
                    </li>
                  ))}
                  {conflicts.length > 5 ? <li className="py-0.5">…and {conflicts.length - 5} more</li> : null}
                </ul>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">If names collide</label>
              <Select value={policy} onValueChange={(v) => setPolicy(v as ConflictPolicy)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(POLICY_LABELS) as ConflictPolicy[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {POLICY_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Nothing is ever overwritten silently. Originals are preserved if a move fails.
              </p>
            </div>
            <DialogFooter>
              {!presetDestination ? (
                <Button variant="ghost" onClick={() => setStep('dest')} disabled={busy}>
                  Back
                </Button>
              ) : null}
              <Button onClick={() => void execute()} disabled={busy}>
                {busy ? `${verb}ing…` : `${verb} ${paths.length === 1 ? 'item' : `${paths.length} items`}`}
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {step === 'done' && results ? (
          <>
            <DialogHeader>
              <DialogTitle>{movedCount > 0 ? `${verb} complete` : `Nothing ${pastVerb}`}</DialogTitle>
              <DialogDescription>Destination: {shortenHome(destination ?? '', homePath)}</DialogDescription>
            </DialogHeader>
            <MoveResultsSummary results={results} />
            <DialogFooter>
              {failedPaths.length > 0 ? (
                <Button variant="outline" onClick={() => void execute(failedPaths)} disabled={busy}>
                  Retry failed ({failedPaths.length})
                </Button>
              ) : null}
              <Button onClick={() => onClose(movedCount > 0)}>Done</Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function DestinationList({
  title,
  paths,
  homePath,
  icon,
  onPick,
  busy
}: {
  title: string
  paths: string[]
  homePath: string
  icon: React.ReactNode
  onPick: (path: string) => void
  busy: boolean
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium text-muted-foreground/70">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {paths.map((p) => (
          <button
            key={p}
            type="button"
            disabled={busy}
            onClick={() => onPick(p)}
            title={p}
            className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {icon}
            <span className="max-w-44 truncate">{shortenHome(p, homePath)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
