import { useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CircleAlert, FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import { tidy, unwrap } from '@/lib/api'
import { shortenHome } from '@/lib/format'
import { useAppStore } from '@/stores/app-store'
import { destinationFor } from '@/lib/rules'
import { MoveResultsSummary } from '@/components/dialogs/MoveDialog'
import {
  DOWNLOAD_CATEGORY_LABELS,
  DOWNLOAD_CATEGORY_ORDER,
  categoryForFile
} from '@shared/constants/categories'
import type { DownloadCategory, FileEntry, MoveConflict, MoveItemResult, ConflictPolicy } from '@shared/types/files'

interface OrganizeDialogProps {
  files: FileEntry[]
  homePath: string
  downloadsPath: string | null
  onClose: (movedAny: boolean) => void
}

type Step = 'plan' | 'review' | 'done'

/** Sensible, existing-folder defaults; categories without one start unset. */
function suggestionFor(category: DownloadCategory, home: string): string | null {
  switch (category) {
    case 'documents':
      return `${home}/Documents`
    case 'images':
      return `${home}/Pictures`
    case 'videos':
      return `${home}/Movies`
    case 'audio':
      return `${home}/Music`
    case 'archives':
      return `${home}/Documents`
    case 'installers':
    case 'other':
      return null
  }
}

export function OrganizeDialog({ files, homePath, downloadsPath, onClose }: OrganizeDialogProps) {
  const settings = useAppStore((s) => s.settings)
  const patchSettings = useAppStore((s) => s.patchSettings)

  const groups = useMemo(() => {
    const map = new Map<DownloadCategory, FileEntry[]>()
    for (const file of files) {
      const cat = categoryForFile(file.name)
      const list = map.get(cat)
      if (list) list.push(file)
      else map.set(cat, [file])
    }
    return map
  }, [files])

  // Initialized lazily from the file groups — the props are fixed for the
  // lifetime of this dialog, so no effect is needed.
  const [assignments, setAssignments] = useState<Record<string, string | null>>(() => {
    const stored = settings?.downloadsDestinations ?? {}
    const initial: Record<string, string | null> = {}
    for (const cat of DOWNLOAD_CATEGORY_ORDER) {
      if (groups.has(cat)) initial[cat] = stored[cat] ?? suggestionFor(cat, homePath)
    }
    return initial
  })
  const [checked, setChecked] = useState<Set<string>>(() => {
    const stored = settings?.downloadsDestinations ?? {}
    const initialChecked = new Set<string>()
    for (const cat of DOWNLOAD_CATEGORY_ORDER) {
      const assigned = stored[cat] ?? suggestionFor(cat, homePath)
      if (assigned) for (const f of groups.get(cat) ?? []) initialChecked.add(f.path)
    }
    // Files matched by an organization rule start checked too.
    const rules = settings?.orgRules ?? []
    if (rules.length > 0) {
      for (const f of files) {
        if (destinationFor(f, rules, {}).destination) initialChecked.add(f.path)
      }
    }
    return initialChecked
  })
  const [step, setStep] = useState<Step>('plan')
  const [conflicts, setConflicts] = useState<MoveConflict[]>([])
  const [policy, setPolicy] = useState<ConflictPolicy>('skip')
  const [results, setResults] = useState<MoveItemResult[]>([])
  const [busy, setBusy] = useState(false)

  const pendingPaths = useMemo(() => files.filter((f) => checked.has(f.path)).map((f) => f.path), [files, checked])

  /**
   * Effective destination per file: a matching organization rule wins over
   * the category default. Rules only pre-fill the plan — the review step
   * still requires explicit confirmation.
   */
  const destFor = (file: FileEntry): { destination: string | null; fromRule: boolean } =>
    destinationFor(file, settings?.orgRules ?? [], assignments)

  const setDestination = (cat: DownloadCategory, dest: string | null): void => {
    setAssignments((current) => ({ ...current, [cat]: dest }))
    if (dest) {
      // Selecting a destination opts that category's files in.
      setChecked((current) => {
        const next = new Set(current)
        for (const f of groups.get(cat) ?? []) next.add(f.path)
        return next
      })
    } else {
      setChecked((current) => {
        const next = new Set(current)
        for (const f of groups.get(cat) ?? []) next.delete(f.path)
        return next
      })
    }
  }

  const browse = async (cat: DownloadCategory): Promise<void> => {
    try {
      const picked = await unwrap(tidy().pickFolder(`Choose a folder for ${DOWNLOAD_CATEGORY_LABELS[cat]}`))
      if (picked) setDestination(cat, picked)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open the folder picker.')
    }
  }

  const toReview = async (): Promise<void> => {
    setBusy(true)
    try {
      // Group checked files by their effective destination (rule → default).
      const byDest = new Map<string, string[]>()
      for (const file of files) {
        if (!checked.has(file.path)) continue
        const dest = destFor(file).destination
        if (!dest) continue
        const list = byDest.get(dest)
        if (list) list.push(file.path)
        else byDest.set(dest, [file.path])
      }
      const found: MoveConflict[] = []
      for (const [dest, paths] of byDest) {
        const c = await unwrap(tidy().checkMoveConflicts(paths, dest))
        found.push(...c)
      }
      setConflicts(found)
      setStep('review')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not review the plan.')
    } finally {
      setBusy(false)
    }
  }

  const execute = async (): Promise<void> => {
    setBusy(true)
    try {
      const byDest = new Map<string, string[]>()
      for (const file of files) {
        if (!checked.has(file.path)) continue
        const dest = destFor(file).destination
        if (!dest) continue
        const list = byDest.get(dest)
        if (list) list.push(file.path)
        else byDest.set(dest, [file.path])
      }
      const all: MoveItemResult[] = []
      for (const [dest, paths] of byDest) {
        const r = await unwrap(tidy().moveItems(paths, dest, policy))
        all.push(...r)
      }
      setResults(all)
      setStep('done')
      const moved = all.filter((r) => r.status !== 'skipped' && r.status !== 'failed').length
      if (moved > 0) {
        toast.success(moved === 1 ? 'Item moved' : `${moved} items organized`)
        // Persist chosen category destinations for next time (rules persist too).
        const dests: Record<string, string> = {}
        for (const cat of DOWNLOAD_CATEGORY_ORDER) {
          const d = assignments[cat]
          if (d) dests[cat] = d
        }
        void patchSettings({ downloadsDestinations: dests })
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Organizing did not finish.')
    } finally {
      setBusy(false)
    }
  }

  const movedCount = results.filter((r) => r.status !== 'failed' && r.status !== 'skipped').length
  const failed = results.filter((r) => r.status === 'failed')

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(movedCount > 0)}>
      <DialogContent className="max-w-2xl">
        {step === 'plan' ? (
          <>
            <DialogHeader>
              <DialogTitle>Organize Downloads</DialogTitle>
              <DialogDescription>
                {downloadsPath ? shortenHome(downloadsPath, homePath) + ' — ' : ''}
                Preview only. Nothing moves until you confirm.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
              {DOWNLOAD_CATEGORY_ORDER.filter((cat) => (groups.get(cat)?.length ?? 0) > 0).map((cat) => {
                const list = groups.get(cat)!
                const dest = assignments[cat] ?? null
                return (
                  <div key={cat} className="rounded-lg border border-border p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`cat-${cat}`}
                          checked={Boolean(dest) && list.every((f) => checked.has(f.path))}
                          onCheckedChange={(v) => {
                            setChecked((current) => {
                              const next = new Set(current)
                              for (const f of list) {
                                if (v === true && dest) next.add(f.path)
                                else next.delete(f.path)
                              }
                              return next
                            })
                          }}
                          disabled={!dest}
                        />
                        <label htmlFor={`cat-${cat}`} className="text-[13px] font-medium">
                          {DOWNLOAD_CATEGORY_LABELS[cat]}
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            {list.length} {list.length === 1 ? 'file' : 'files'}
                          </span>
                        </label>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="max-w-52 truncate text-xs text-muted-foreground" title={dest ?? undefined}>
                          {dest ? shortenHome(dest, homePath) : 'No destination chosen'}
                        </span>
                        {dest ? (
                          <Button variant="ghost" size="sm" onClick={() => setDestination(cat, null)}>
                            Clear
                          </Button>
                        ) : null}
                        <Button variant="outline" size="sm" className="gap-1" onClick={() => void browse(cat)}>
                          <FolderOpen className="size-3.5" />
                          Choose…
                        </Button>
                      </div>
                    </div>
                    {dest ? (
                      <ul className="ml-6 space-y-0.5">
                        {list.slice(0, 4).map((f) => {
                          const override = destFor(f)
                          return (
                            <li key={f.path} className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Checkbox
                                checked={checked.has(f.path)}
                                onCheckedChange={(v) => {
                                  setChecked((current) => {
                                    const next = new Set(current)
                                    if (v === true) next.add(f.path)
                                    else next.delete(f.path)
                                    return next
                                  })
                                }}
                                className="size-3"
                              />
                              <span className="truncate">{f.name}</span>
                              {override.destination && override.destination !== dest ? (
                                <span
                                  className="shrink-0 rounded bg-primary/10 px-1 text-[11px] text-primary"
                                  title={`Organization rule → ${shortenHome(override.destination, homePath)}`}
                                >
                                  via rule
                                </span>
                              ) : null}
                            </li>
                          )
                        })}
                        {list.length > 4 ? (
                          <li className="ml-6 text-xs text-muted-foreground">…and {list.length - 4} more</li>
                        ) : null}
                      </ul>
                    ) : (
                      <p className="ml-6 text-xs text-muted-foreground/70">
                        Choose a destination to include these files.
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onClose(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => void toReview()} disabled={busy || pendingPaths.length === 0}>
                {busy ? 'Reviewing…' : `Review ${pendingPaths.length} ${pendingPaths.length === 1 ? 'move' : 'moves'}`}
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {step === 'review' ? (
          <>
            <DialogHeader>
              <DialogTitle>Confirm {pendingPaths.length} moves</DialogTitle>
              <DialogDescription>Each file goes to the folder shown in the plan.</DialogDescription>
            </DialogHeader>
            {conflicts.length > 0 ? (
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                  <CircleAlert className="size-3.5" />
                  {conflicts.length} name {conflicts.length === 1 ? 'conflict' : 'conflicts'} detected
                </p>
                <ul className="max-h-24 overflow-y-auto rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
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
                  <SelectItem value="skip">Skip conflicting items</SelectItem>
                  <SelectItem value="replace">Replace existing files</SelectItem>
                  <SelectItem value="keep-both">Keep both (add “(2)” to the name)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Originals are preserved if any move fails. Failures are reported per file.
              </p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep('plan')} disabled={busy}>
                Back
              </Button>
              <Button onClick={() => void execute()} disabled={busy}>
                {busy ? 'Moving…' : `Move ${pendingPaths.length} items`}
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {step === 'done' ? (
          <>
            <DialogHeader>
              <DialogTitle>{movedCount > 0 ? 'Downloads organized' : 'Nothing moved'}</DialogTitle>
              <DialogDescription>Per-file results for this batch.</DialogDescription>
            </DialogHeader>
            <MoveResultsSummary results={results} />
            <DialogFooter>
              {failed.length > 0 ? (
                <Button variant="outline" onClick={() => setStep('plan')} disabled={busy}>
                  Back to plan
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
