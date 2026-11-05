import type { AccentId, ThemePreference } from '@shared/types/settings'

/**
 * Accent color presets. Values are oklch() strings applied to CSS custom
 * properties at runtime, in both light and dark variants — so every accent
 * works with system/light/dark without extra stylesheets.
 */

export interface AccentPreset {
  label: string
  /** Hex used for the swatch in Settings. */
  swatch: string
  light: { primary: string; ring: string }
  dark: { primary: string; ring: string }
}

export const ACCENTS: Record<AccentId, AccentPreset> = {
  blue: {
    label: 'Blue',
    swatch: '#3f6f9f',
    light: { primary: 'oklch(0.52 0.09 220)', ring: 'oklch(0.6 0.09 220)' },
    dark: { primary: 'oklch(0.68 0.1 220)', ring: 'oklch(0.55 0.09 220)' }
  },
  teal: {
    label: 'Teal',
    swatch: '#1f9e8e',
    light: { primary: 'oklch(0.5 0.09 175)', ring: 'oklch(0.58 0.09 175)' },
    dark: { primary: 'oklch(0.7 0.1 175)', ring: 'oklch(0.53 0.09 175)' }
  },
  purple: {
    label: 'Purple',
    swatch: '#8256c9',
    light: { primary: 'oklch(0.5 0.13 300)', ring: 'oklch(0.58 0.12 300)' },
    dark: { primary: 'oklch(0.68 0.12 300)', ring: 'oklch(0.52 0.11 300)' }
  },
  rose: {
    label: 'Rose',
    swatch: '#d94f63',
    light: { primary: 'oklch(0.55 0.17 15)', ring: 'oklch(0.62 0.16 15)' },
    dark: { primary: 'oklch(0.68 0.15 15)', ring: 'oklch(0.53 0.14 15)' }
  },
  orange: {
    label: 'Orange',
    swatch: '#d9822b',
    light: { primary: 'oklch(0.62 0.15 55)', ring: 'oklch(0.68 0.14 55)' },
    dark: { primary: 'oklch(0.72 0.13 55)', ring: 'oklch(0.58 0.12 55)' }
  },
  graphite: {
    label: 'Graphite',
    swatch: '#565a63',
    light: { primary: 'oklch(0.42 0.01 260)', ring: 'oklch(0.55 0.01 260)' },
    dark: { primary: 'oklch(0.72 0.006 260)', ring: 'oklch(0.6 0.006 260)' }
  }
}

export const ACCENT_IDS = Object.keys(ACCENTS) as AccentId[]

export function isAccentId(value: unknown): value is AccentId {
  return typeof value === 'string' && value in ACCENTS
}

export function resolveIsDark(preference: ThemePreference): boolean {
  if (preference === 'dark') return true
  if (preference === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Apply the accent's CSS custom properties for the current theme mode.
 * Overriding the :root variables keeps every shadcn component in sync.
 */
export function applyAccent(accent: AccentId, preference: ThemePreference): void {
  const preset = ACCENTS[accent] ?? ACCENTS.blue
  const values = resolveIsDark(preference) ? preset.dark : preset.light
  const root = document.documentElement
  root.style.setProperty('--primary', values.primary)
  root.style.setProperty('--ring', values.ring)
  root.style.setProperty('--sidebar-primary', values.primary)
  root.style.setProperty('--sidebar-ring', values.ring)
  // On dark mode the accent is lighter, so button text flips dark.
  root.style.setProperty(
    '--primary-foreground',
    resolveIsDark(preference) ? 'oklch(0.16 0.01 260)' : 'oklch(0.985 0.002 90)'
  )
}
