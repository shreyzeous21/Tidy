import { useState } from 'react'
import { FolderOpen, X, Keyboard, Info, Database, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { tidy, unwrap, messageOf } from '@/lib/api'
import { ToolbarLabel, ToolbarSpacer, ViewToolbar } from '@/components/common/ViewToolbar'
import { shortenHome } from '@/lib/format'
import { ACCENTS, ACCENT_IDS, applyAccent } from '@/lib/theme'
import { useAppStore, applyTheme } from '@/stores/app-store'
import { useMetaStore } from '@/stores/browser-store'
import {
  DOWNLOAD_CATEGORY_LABELS,
  DOWNLOAD_CATEGORY_ORDER
} from '@shared/constants/categories'
import type { ThemePreference } from '@shared/types/settings'
import type { DownloadCategory } from '@shared/types/files'
import { cn } from 'cn'

const THEMES: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

const SHORTCUTS: Array<[string, string]> = [
  ['⌘ 1–9', 'Switch sections (⌘5 = Apps)'],
  ['⌘ K', 'Command palette'],
  ['⌘ F', 'Search'],
  ['⌘ ⇧ M', 'Quick Move (Files view)'],
  ['⌘ T / ⌘ W', 'New / close tab (Files)'],
  ['⌘ I', 'Get Info (Files selection)'],
  ['Enter', 'Open selection'],
  ['Space', 'Quick Look (native preview)'],
  ['⌘ ↑', 'Enclosing folder'],
  ['⌘ A', 'Select all'],
  ['⌘ ⌫', 'Move selection to Trash'],
  ['⌘ ⇧ .', 'Show / hide hidden files'],
  ['Esc', 'Clear selection / close dialogs']
]

export function SettingsView() {
  const settings = useAppStore((s) => s.settings)
  const patchSettings = useAppStore((s) => s.patchSettings)
  const homePath = useMetaStore((s) => s.homePath)
  const appInfo = useMetaStore((s) => s.appInfo)

  const [confirm, setConfirm] = useState<'history' | 'reset' | null>(null)

  if (!settings) return null

  const addPinned = async (): Promise<void> => {
    try {
      const picked = await unwrap(tidy().pickFolder('Choose a folder to pin'))
      if (picked && !settings.pinnedFolders.includes(picked)) {
        void patchSettings({ pinnedFolders: [...settings.pinnedFolders, picked] })
      }
    } catch (error) {
      toast.error(messageOf(error))
    }
  }

  const setCategoryDestination = async (category: DownloadCategory): Promise<void> => {
    try {
      const picked = await unwrap(tidy().pickFolder(`Destination for ${DOWNLOAD_CATEGORY_LABELS[category]}`))
      if (picked) {
        void patchSettings({
          downloadsDestinations: { ...settings.downloadsDestinations, [category]: picked }
        })
      }
    } catch (error) {
      toast.error(messageOf(error))
    }
  }

  const clearCategoryDestination = (category: DownloadCategory): void => {
    const next = { ...settings.downloadsDestinations }
    delete next[category]
    void patchSettings({ downloadsDestinations: next })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewToolbar>
        <ToolbarLabel>{appInfo ? `Tidy v${appInfo.versions.app}` : 'Tidy'}</ToolbarLabel>
        <ToolbarSpacer />
      </ViewToolbar>

      <div className="min-h-0 w-full flex-1 space-y-7 overflow-y-auto px-4 py-4">
        <section>
          <h2 className="mb-2 text-[13px] font-semibold">Appearance</h2>
          <div className="flex rounded-md border border-border p-0.5" role="radiogroup" aria-label="Theme">
            {THEMES.map((theme) => (
              <button
                key={theme.value}
                type="button"
                role="radio"
                aria-checked={settings.theme === theme.value}
                onClick={() => {
                  void patchSettings({ theme: theme.value })
                  applyTheme(theme.value)
                  applyAccent(settings.accent, theme.value)
                }}
                className={cn(
                  'flex-1 rounded px-3 py-1.5 text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring',
                  settings.theme === theme.value
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {theme.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Follows macOS appearance when set to System.
          </p>

          <h3 className="mb-2 mt-4 text-[13px] font-semibold">Accent color</h3>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent color">
            {ACCENT_IDS.map((id) => {
              const preset = ACCENTS[id]
              const selected = settings.accent === id
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`Accent: ${preset.label}`}
                  title={preset.label}
                  onClick={() => {
                    void patchSettings({ accent: id })
                    applyAccent(id, settings.theme)
                  }}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring',
                    selected ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-foreground/5'
                  )}
                >
                  <span
                    className="size-3.5 rounded-full ring-1 ring-inset ring-black/10"
                    style={{ backgroundColor: preset.swatch }}
                  />
                  {preset.label}
                </button>
              )
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-[13px] font-semibold">Pinned folders</h2>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Pinned folders appear as Quick Move destinations everywhere.
          </p>
          <ul className="space-y-1">
            {settings.pinnedFolders.map((folder) => (
              <li
                key={folder}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs"
              >
                <FolderOpen className="size-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate" title={folder}>
                  {shortenHome(folder, homePath)}
                </span>
                <button
                  type="button"
                  aria-label={`Unpin ${folder}`}
                  onClick={() =>
                    void patchSettings({ pinnedFolders: settings.pinnedFolders.filter((f) => f !== folder) })
                  }
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <Button variant="outline" size="sm" className="mt-2 gap-1.5" onClick={() => void addPinned()}>
            <FolderOpen className="size-3.5" />
            Pin folder…
          </Button>
        </section>

        <section>
          <h2 className="mb-2 text-[13px] font-semibold">Downloads destinations</h2>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Defaults used when organizing Downloads. You can change them per run.
          </p>
          <ul className="space-y-1">
            {DOWNLOAD_CATEGORY_ORDER.map((category) => {
              const dest = settings.downloadsDestinations[category]
              return (
                <li key={category} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs">
                  <span className="w-20 shrink-0 font-medium">{DOWNLOAD_CATEGORY_LABELS[category]}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground" title={dest}>
                    {dest ? shortenHome(dest, homePath) : 'Not set'}
                  </span>
                  <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => void setCategoryDestination(category)}>
                    {dest ? 'Change' : 'Choose…'}
                  </Button>
                  {dest ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-[11px]"
                      onClick={() => clearCategoryDestination(category)}
                    >
                      Clear
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>

        <section>
          <h2 className="mb-1 text-[13px] font-semibold">Organization rules</h2>
          <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
            The first matching rule assigns a destination during Downloads organizing — for example
            “Invoices → ~/Documents/Finance”. Rules are suggestions only: files never move without
            your review.
          </p>
          <ul className="space-y-1.5">
            {settings.orgRules.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-xs">
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={(v) =>
                    void patchSettings({
                      orgRules: settings.orgRules.map((r) => (r.id === rule.id ? { ...r, enabled: v === true } : r))
                    })
                  }
                  aria-label={`Rule ${rule.id} enabled`}
                />
                <select
                  value={rule.category}
                  onChange={(event) =>
                    void patchSettings({
                      orgRules: settings.orgRules.map((r) =>
                        r.id === rule.id ? { ...r, category: event.target.value as typeof r.category } : r
                      )
                    })
                  }
                  className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
                  aria-label="Rule category"
                >
                  <option value="any">Any type</option>
                  {DOWNLOAD_CATEGORY_ORDER.map((category) => (
                    <option key={category} value={category}>
                      {DOWNLOAD_CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </select>
                <Input
                  value={rule.nameContains}
                  onChange={(event) =>
                    void patchSettings({
                      orgRules: settings.orgRules.map((r) =>
                        r.id === rule.id ? { ...r, nameContains: event.target.value } : r
                      )
                    })
                  }
                  placeholder="name contains…"
                  className="h-7 w-40 text-xs"
                  aria-label="Name contains"
                />
                <span className="text-muted-foreground">→</span>
                <span className="min-w-0 max-w-52 flex-1 truncate text-muted-foreground" title={rule.destination}>
                  {shortenHome(rule.destination, homePath)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px]"
                  onClick={async () => {
                    try {
                      const picked = await unwrap(tidy().pickFolder('Rule destination'))
                      if (picked) {
                        void patchSettings({
                          orgRules: settings.orgRules.map((r) => (r.id === rule.id ? { ...r, destination: picked } : r))
                        })
                      }
                    } catch (error) {
                      toast.error(messageOf(error))
                    }
                  }}
                >
                  Choose…
                </Button>
                <button
                  type="button"
                  aria-label={`Delete rule`}
                  onClick={() => void patchSettings({ orgRules: settings.orgRules.filter((r) => r.id !== rule.id) })}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => {
              const rule = {
                id: `rule-${Date.now()}`,
                enabled: true,
                category: 'any' as const,
                nameContains: '',
                destination: homePath === '/' ? homePath : homePath + '/Documents'
              }
              void patchSettings({ orgRules: [...settings.orgRules, rule] })
            }}
          >
            Add rule
          </Button>
        </section>

        <section>
          <h2 className="mb-1.5 text-[13px] font-semibold">Access on this Mac</h2>
          <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted-foreground/90">
            <li>
              <span className="font-medium text-foreground">Read anywhere.</span> Tidy can browse the
              entire system — open <button type="button" className="underline underline-offset-2" onClick={() => useAppStore.getState().setView('home')}>Home → Macintosh HD</button> to
              start from the root of your disk.
            </li>
            <li>
              <span className="font-medium text-foreground">Changes stay in approved places.</span>{' '}
              Renames, duplicates, moves, and Trash are limited to your home folder plus folders you
              explicitly chose with “Choose folder…”.
            </li>
            <li>
              <span className="font-medium text-foreground">Full Disk Access.</span> macOS guards
              some system folders. If a folder shows a permission notice, grant Tidy access in
              System Settings → Privacy & Security → Full Disk Access.
            </li>
            <li>
              <span className="font-medium text-foreground">Local only.</span> Filenames and metadata
              never leave this Mac — Tidy has no network features.
            </li>
          </ul>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 gap-1.5"
            onClick={() => useAppStore.getState().openPermissions()}
          >
            <ShieldCheck className="size-3.5" />
            Review permissions
          </Button>
        </section>

        <Separator />

        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
            <Database className="size-3.5 text-muted-foreground" />
            Data
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirm('history')}>
              Clear activity history
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirm('reset')}>
              Reset all settings
            </Button>
          </div>
        </section>

        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
            <Keyboard className="size-3.5 text-muted-foreground" />
            Keyboard shortcuts
          </h2>
          <table className="w-full text-xs">
            <tbody>
              {SHORTCUTS.map(([keys, action]) => (
                <tr key={keys} className="border-b border-border/40 last:border-b-0">
                  <td className="w-28 py-1.5 font-mono text-[11px]">{keys}</td>
                  <td className="py-1.5 text-muted-foreground">{action}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1.5 text-[11px] text-muted-foreground/80">
            Shortcuts work inside the app window only; Tidy registers no global shortcuts.
          </p>
        </section>

        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
            <Info className="size-3.5 text-muted-foreground" />
            About
          </h2>
          {appInfo ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <dt>Tidy</dt>
              <dd>v{appInfo.versions.app}</dd>
              <dt>Engine</dt>
              <dd>
                Electron {appInfo.versions.electron} · Chromium {appInfo.versions.chrome} · Node{' '}
                {appInfo.versions.node}
              </dd>
              <dt>Search backend</dt>
              <dd>{appInfo.mdfindAvailable ? 'macOS Spotlight (mdfind) with local fallback' : 'Local scan only (Spotlight unavailable)'}</dd>
            </dl>
          ) : null}
        </section>
      </div>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{confirm === 'history' ? 'Clear activity history?' : 'Reset all settings?'}</DialogTitle>
            <DialogDescription>
              {confirm === 'history'
                ? 'The list of renames, moves, and trashes recorded in Tidy will be erased. Your files are untouched.'
                : 'Theme, pins, destinations, and thresholds return to defaults. Your files are untouched.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const action = confirm
                setConfirm(null)
                if (action === 'history') {
                  void unwrap(tidy().clearHistory())
                    .then(() => toast.success('History cleared'))
                    .catch((error) => toast.error(messageOf(error)))
                } else {
                  void unwrap(tidy().resetSettings())
                    .then(() => {
                      void useAppStore.getState().loadSettings()
                      toast.success('Settings reset')
                    })
                    .catch((error) => toast.error(messageOf(error)))
                }
              }}
            >
              {confirm === 'history' ? 'Clear history' : 'Reset settings'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
