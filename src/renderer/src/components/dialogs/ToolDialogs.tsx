import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Copy, Check, CircleAlert, GitBranch, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { tidy, unwrap } from '@/lib/api'
import { formatBytes, formatRelative } from '@/lib/format'
import type { RepoInfo, TimelineEvent } from '@shared/types/cleanup'
import type { FolderCompareResult } from '@shared/types/cleanup'
import type { LaunchAgentInfo } from '@shared/types/info'

// ---------- #9/#47 Checksum calculator ----------

function HashRow({ label, value, onCopy }: { label: string; value: string | null; onCopy: (value: string, label: string) => void }) {
  return (
    <div className="py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {value ? (
          <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[11px]" onClick={() => onCopy(value, label)}>
            <Copy className="size-3" /> Copy
          </Button>
        ) : null}
      </div>
      <code className="block break-all rounded-md border border-border bg-muted/40 px-2 py-1.5 font-mono text-[11px]">
        {value ?? 'computing…'}
      </code>
    </div>
  )
}

export function ChecksumDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const [sha256, setSha256] = useState<string | null>(null)
  const [md5, setMd5] = useState<string | null>(null)
  const [expected, setExpected] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void unwrap(tidy().checksum(path, 'sha256'))
      .then((r) => !cancelled && setSha256(r.hex))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [path])

  const computeMd5 = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await unwrap(tidy().checksum(path, 'md5'))
      setMd5(r.hex)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed.')
    } finally {
      setBusy(false)
    }
  }

  const name = path.split('/').pop() ?? path
  const copy = (value: string, label: string): void => {
    void navigator.clipboard.writeText(value).then(() => toast.success(`${label} copied`))
  }
  const matches = expected.trim() ? { sha256: sha256?.toLowerCase() === expected.trim().toLowerCase(), md5: md5?.toLowerCase() === expected.trim().toLowerCase() } : null


  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate">Checksum — {name}</DialogTitle>
          <DialogDescription>Streamed locally; nothing is uploaded. Paste a hash to verify.</DialogDescription>
        </DialogHeader>
        <HashRow label="SHA-256" value={sha256} onCopy={copy} />
        {md5 ? <HashRow label="MD5" value={md5} onCopy={copy} /> : null}
        <div className="flex items-end gap-2">
          <Input
            value={expected}
            onChange={(event) => setExpected(event.target.value)}
            placeholder="Expected hash (to verify)"
            className="h-8 font-mono text-xs"
            aria-label="Expected hash"
          />
          {!md5 ? (
            <Button variant="outline" size="sm" onClick={() => void computeMd5()} disabled={busy}>
              {busy ? '…' : 'MD5'}
            </Button>
          ) : null}
        </div>
        {matches ? (
          <p className="flex items-center gap-1.5 text-xs">
            {matches.sha256 || matches.md5 ? (
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <Check className="size-3.5" /> Hash matches — the file is intact.
              </span>
            ) : (
              <span className="flex items-center gap-1 text-destructive">
                <CircleAlert className="size-3.5" /> Hash does not match — the file differs from the expected one.
              </span>
            )}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ---------- #2 Folder comparison ----------

export function CompareFoldersDialog({ onClose }: { onClose: () => void }) {
  const [folderA, setFolderA] = useState('')
  const [folderB, setFolderB] = useState('')
  const [result, setResult] = useState<FolderCompareResult | null>(null)
  const [busy, setBusy] = useState(false)

  const pick = async (which: 'a' | 'b'): Promise<void> => {
    try {
      const picked = await unwrap(tidy().pickFolder(`Choose folder ${which.toUpperCase()}`))
      if (picked) {
        if (which === 'a') setFolderA(picked)
        else setFolderB(picked)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open the picker.')
    }
  }

  const compare = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await unwrap(tidy().compareFolders(folderA, folderB))
      setResult(r)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Comparison failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Compare folders</DialogTitle>
          <DialogDescription>
            Same-size files are verified by a 64 KB content hash, so “identical” really means identical.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {(['a', 'b'] as const).map((which) => (
            <div key={which} className="flex items-center gap-2">
              <span className="w-6 text-xs font-semibold text-muted-foreground">{which.toUpperCase()}</span>
              <Input
                readOnly
                value={which === 'a' ? folderA : folderB}
                placeholder="No folder chosen"
                className="h-8 flex-1 text-xs"
                aria-label={`Folder ${which.toUpperCase()}`}
              />
              <Button variant="outline" size="sm" onClick={() => void pick(which)}>
                Choose…
              </Button>
            </div>
          ))}
          <Button size="sm" onClick={() => void compare()} disabled={busy || !folderA || !folderB} className="w-full">
            {busy ? 'Comparing…' : 'Compare'}
          </Button>
        </div>
        {result ? (
          <div className="max-h-72 space-y-3 overflow-y-auto text-xs">
            <p className="text-muted-foreground">
              {result.identicalCount.toLocaleString()} identical · {result.onlyInA.length} only in A ·{' '}
              {result.onlyInB.length} only in B · {result.differing.length} differ
              {result.truncated ? ' (results capped)' : ''}
            </p>
            <CompareList title="Only in A" items={result.onlyInA} />
            <CompareList title="Only in B" items={result.onlyInB} />
            <CompareList title="Differing content" items={result.differing} destructive />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function CompareList({ title, items, destructive }: { title: string; items: string[]; destructive?: boolean }) {
  if (items.length === 0) return null
  return (
    <div>
      <p className="mb-1 font-medium">{title} ({items.length})</p>
      <ul className={`max-h-28 overflow-y-auto rounded-md border border-border bg-muted/40 px-2.5 py-1.5 ${destructive ? 'text-destructive' : 'text-muted-foreground'}`}>
        {items.slice(0, 60).map((item) => (
          <li key={item} className="truncate py-0.5">{item}</li>
        ))}
        {items.length > 60 ? <li className="py-0.5">…and {items.length - 60} more</li> : null}
      </ul>
    </div>
  )
}

// ---------- #31/#32/#33 Git status viewer ----------

export function GitStatusDialog({ repo, onClose }: { repo: RepoInfo; onClose: () => void }) {
  const [lines, setLines] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void unwrap(tidy().gitStatus(repo.path))
      .then((r) => !cancelled && setLines(r))
      .catch((cause) => !cancelled && setError(cause instanceof Error ? cause.message : 'git status failed.'))
    return () => {
      cancelled = true
    }
  }, [repo.path])

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="size-4 text-muted-foreground" />
            <span className="truncate">{repo.name}</span>
            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-normal text-primary">
              {repo.branch || '—'}
            </span>
          </DialogTitle>
          <DialogDescription className="truncate">{repo.path}</DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {repo.modified} changed · {repo.untracked} untracked · .git {formatBytes(repo.gitBytes)}
          {repo.lastCommit ? ` · last commit ${repo.lastCommit}` : ''}
        </p>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {lines === null && !error ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Running git status…</p>
        ) : (
          <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed">
            {lines && lines.length > 0 ? lines.join('\n') : 'Working tree clean.'}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------- #44 Change timeline ----------

export function TimelineDialog({ onClose }: { onClose: () => void }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null)

  useEffect(() => {
    void unwrap(tidy().getTimeline())
      .then(setEvents)
      .catch(() => setEvents([]))
  }, [])

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground" /> Recent changes
          </DialogTitle>
          <DialogDescription>
            Live changes Tidy observed in the folder you’re browsing (last 200 events, this session).
          </DialogDescription>
        </DialogHeader>
        {events === null ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
        ) : events.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No changes recorded yet.</p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto text-xs">
            {[...events].reverse().map((event, index) => (
              <li key={`${event.at}-${index}`} className="flex items-center gap-2 border-b border-border/40 py-1 last:border-b-0">
                <span className="w-14 shrink-0 font-mono text-[10px] text-muted-foreground">{event.event}</span>
                <span className="min-w-0 flex-1 truncate" title={event.name}>{event.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatRelative(event.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------- #53/#54 Login items + launch agents ----------

export function LoginAgentsDialog({ onClose }: { onClose: () => void }) {
  const [loginItems, setLoginItems] = useState<string[] | null>(null)
  const [agents, setAgents] = useState<LaunchAgentInfo[] | null>(null)

  useEffect(() => {
    void unwrap(tidy().listLoginItems())
      .then(setLoginItems)
      .catch(() => setLoginItems([]))
    void unwrap(tidy().listLaunchAgents())
      .then(setAgents)
      .catch(() => setAgents([]))
  }, [])

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Login items & launch agents</DialogTitle>
          <DialogDescription>What launches alongside macOS. Read-only — manage them in System Settings.</DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-4 overflow-y-auto text-xs">
          <section>
            <p className="mb-1 font-medium">Login items</p>
            {loginItems === null ? (
              <p className="text-muted-foreground">Reading…</p>
            ) : loginItems.length === 0 ? (
              <p className="text-muted-foreground">None found (or macOS didn’t share the list).</p>
            ) : (
              <ul className="rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
                {loginItems.map((item) => (
                  <li key={item} className="truncate py-0.5">{item}</li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <p className="mb-1 font-medium">Launch agents ({agents?.length ?? '…'})</p>
            {agents === null ? (
              <p className="text-muted-foreground">Reading…</p>
            ) : agents.length === 0 ? (
              <p className="text-muted-foreground">None found.</p>
            ) : (
              <ul className="space-y-1">
                {agents.map((agent) => (
                  <li key={agent.path} className="rounded-md border border-border px-2.5 py-1.5">
                    <p className="truncate font-medium">{agent.label}</p>
                    {agent.program ? <p className="truncate text-muted-foreground" title={agent.program}>{agent.program}</p> : null}
                    <p className="truncate text-[11px] text-muted-foreground/70" title={agent.path}>{agent.path}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------- #52 App leftovers ----------

export function LeftoversDialog({ onClose, onTrash }: { onClose: () => void; onTrash: (paths: string[]) => void }) {
  const [items, setItems] = useState<import('@shared/types/files').FileEntry[] | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    void unwrap(tidy().getAppLeftovers())
      .then(setItems)
      .catch(() => setItems([]))
  }, [])

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Application leftovers</DialogTitle>
          <DialogDescription>
            Application Support folders whose name doesn’t match any installed app. Heuristic — review carefully;
            some entries belong to apps installed outside /Applications or to system services.
          </DialogDescription>
        </DialogHeader>
        {items === null ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Scanning…</p>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No unmatched folders found.</p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto text-xs">
            {items.map((item) => (
              <li key={item.path} className="flex items-center gap-2 border-b border-border/40 py-1.5 last:border-b-0">
                <input
                  type="checkbox"
                  checked={selected.has(item.path)}
                  onChange={(event) =>
                    setSelected((current) => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(item.path)
                      else next.delete(item.path)
                      return next
                    })
                  }
                  aria-label={`Select ${item.name}`}
                />
                <span className="min-w-0 flex-1 truncate" title={item.path}>{item.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[11px]"
                  onClick={() => void unwrap(tidy().revealInFinder(item.path)).catch(() => {})}
                >
                  Reveal
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button
            variant="destructive"
            disabled={selected.size === 0}
            onClick={() => {
              onTrash([...selected])
              onClose()
            }}
          >
            Move {selected.size} to Trash…
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
