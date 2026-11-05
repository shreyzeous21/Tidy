import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FolderOpen,
  Loader2,
  ShieldCheck,
  Sparkles
} from 'lucide-react'
import logoUrl from '@/assets/logo.png'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { tidy, unwrap, messageOf } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import { PERMISSION_IDS } from '@shared/types/permissions'
import type { PermissionId, PermissionState } from '@shared/types/permissions'
import type { LucideIcon } from 'lucide-react'

/**
 * First-run macOS access onboarding: one permission per step, matching how
 * macOS itself asks. Folder access raises the native prompts; Full Disk Access
 * (needed for the Trash) can only be toggled in System Settings, so we deep-link
 * there and poll for the change.
 */

type Step = { kind: 'intro' } | { kind: 'perm'; id: PermissionId } | { kind: 'done' }

interface PermissionMeta {
  title: string
  blurb: string
  bullets: string[]
  icon: LucideIcon
  systemSettingsOnly: boolean
}

const PERMISSION_META: Record<PermissionId, PermissionMeta> = {
  folders: {
    title: 'Your files',
    blurb:
      'Tidy reads Desktop, Documents, and Downloads to browse, organize, and clean them. macOS shows its own prompt for each folder.',
    bullets: [
      'Desktop, Documents & Downloads',
      'Nothing is uploaded — everything stays on this Mac'
    ],
    icon: FolderOpen,
    systemSettingsOnly: false
  },
  fullDiskAccess: {
    title: 'Full Disk Access',
    blurb:
      'Lets Tidy reach the Trash and other protected folders for cleanup. macOS has no in-app prompt for this — you switch it on in System Settings.',
    bullets: ['Required to view and empty the Trash', 'Enable Tidy in System Settings → Privacy & Security'],
    icon: ShieldCheck,
    systemSettingsOnly: true
  }
}

function StatusPill({ state }: { state: PermissionState | undefined }) {
  if (!state) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Checking...
      </span>
    )
  }
  if (state === 'granted') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
        <Check className="size-3" strokeWidth={3} />
        Granted
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
      Not granted
    </span>
  )
}

export function PermissionsDialog() {
  const open = useAppStore((s) => s.permissionsOpen)
  const closePermissions = useAppStore((s) => s.closePermissions)
  const patchSettings = useAppStore((s) => s.patchSettings)

  const [stepIndex, setStepIndex] = useState(0)
  const [statuses, setStatuses] = useState<Partial<Record<PermissionId, PermissionState>>>({})
  const [busy, setBusy] = useState<PermissionId | null>(null)
  const [error, setError] = useState<string | null>(null)

  const steps = useMemo<Step[]>(
    () => [{ kind: 'intro' }, ...PERMISSION_IDS.map((id) => ({ kind: 'perm' as const, id })), { kind: 'done' }],
    []
  )
  const step = steps[Math.min(stepIndex, steps.length - 1)]

  // Reset to the first step each time the dialog opens.
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStepIndex(0)
    setError(null)
    setStatuses({})
  }, [open])

  // Poll permission state while open, and re-check when the user returns from
  // System Settings (window focus).
  useEffect(() => {
    if (!open) return
    let cancelled = false

    const refresh = async (): Promise<void> => {
      try {
        const next = await unwrap(tidy().getPermissionStatuses())
        if (cancelled) return
        const map: Partial<Record<PermissionId, PermissionState>> = {}
        for (const status of next) map[status.id] = status.state
        setStatuses(map)
      } catch {
        // Keep the last known state on a transient failure.
      }
    }

    void refresh()
    const timer = window.setInterval(() => void refresh(), 1500)
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [open])

  const allow = async (id: PermissionId): Promise<void> => {
    setBusy(id)
    setError(null)
    try {
      if (PERMISSION_META[id].systemSettingsOnly) {
        await unwrap(tidy().openPermissionSettings(id))
      } else {
        const status = await unwrap(tidy().requestPermission(id))
        setStatuses((current) => ({ ...current, [status.id]: status.state }))
      }
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(null)
    }
  }

  const finish = (): void => {
    void patchSettings({ onboardingCompleted: true }).catch(() => {})
    closePermissions()
  }

  const goNext = (): void => setStepIndex((index) => Math.min(index + 1, steps.length - 1))
  const goBack = (): void => setStepIndex((index) => Math.max(index - 1, 0))

  const grantedCount = PERMISSION_IDS.filter((id) => statuses[id] === 'granted').length

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        className="max-w-md gap-0 overflow-hidden p-0"
      >
        {/* Branded banner */}
        <div className="flex items-center gap-2.5 border-b border-border bg-muted/40 px-5 py-3.5">
          <img src={logoUrl} alt="" className="size-8 rounded-lg" draggable={false} />
          <div className="leading-tight">
            <DialogTitle className="text-sm font-semibold">Set up Tidy</DialogTitle>
            <p className="text-[11px] text-muted-foreground">Clean. Organize. Optimize.</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {steps.map((_, index) => (
              <span
                key={index}
                className={
                  index === stepIndex
                    ? 'size-1.5 rounded-full bg-primary'
                    : 'size-1.5 rounded-full bg-border'
                }
              />
            ))}
          </div>
        </div>

        <div className="min-h-[220px] px-5 py-5">
          {step.kind === 'intro' ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <img src={logoUrl} alt="" className="size-16 rounded-2xl shadow-sm" draggable={false} />
              <div>
                <h2 className="text-base font-semibold">Welcome to Tidy</h2>
                <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                  A couple of macOS permissions make browsing, cleanup, and the Trash work. We'll walk
                  through them one at a time.
                </p>
              </div>
            </div>
          ) : step.kind === 'perm' ? (
            (() => {
              const meta = PERMISSION_META[step.id]
              const Icon = meta.icon
              const state = statuses[step.id]
              return (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-sm font-semibold">{meta.title}</h2>
                      <div className="mt-0.5">
                        <StatusPill state={state} />
                      </div>
                    </div>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{meta.blurb}</p>
                  <ul className="space-y-1">
                    {meta.bullets.map((bullet) => (
                      <li key={bullet} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        {bullet}
                      </li>
                    ))}
                  </ul>
                  {state !== 'granted' ? (
                    <Button
                      size="sm"
                      className="mt-1 w-fit gap-1.5"
                      onClick={() => void allow(step.id)}
                      disabled={busy !== null}
                    >
                      {busy === step.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : meta.systemSettingsOnly ? (
                        <ArrowRight className="size-3.5" />
                      ) : (
                        <FolderOpen className="size-3.5" />
                      )}
                      {meta.systemSettingsOnly ? 'Open System Settings' : 'Allow access'}
                    </Button>
                  ) : (
                    <span className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      <Check className="size-3.5" strokeWidth={3} />
                      You're all set for this one.
                    </span>
                  )}
                </div>
              )
            })()
          ) : (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="size-6" />
              </span>
              <div>
                <h2 className="text-base font-semibold">You're ready to go</h2>
                <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                  {grantedCount}/{PERMISSION_IDS.length} permissions granted. You can review or change
                  these any time in Settings → Access on this Mac.
                </p>
              </div>
            </div>
          )}

          {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-5 py-3.5">
          {step.kind !== 'intro' ? (
            <Button variant="ghost" size="sm" onClick={goBack}>
              <ArrowLeft className="size-3.5" />
              Back
            </Button>
          ) : null}
          <div className="flex-1" />
          {step.kind === 'done' ? (
            <Button size="sm" className="gap-1.5" onClick={finish}>
              <Sparkles className="size-3.5" />
              Finish
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={finish}>
                Set up later
              </Button>
              <Button size="sm" className="gap-1.5" onClick={goNext}>
                {step.kind === 'intro' ? 'Set up access' : 'Next'}
                <ArrowRight className="size-3.5" />
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
