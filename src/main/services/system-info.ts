import { execFile } from 'node:child_process'
import os from 'node:os'
import { promisify } from 'node:util'
import type { SystemInfo } from '@shared/types/info'

/**
 * Hardware summary for the sidebar card.
 *
 * `sysctl` answers instantly; `system_profiler` supplies the marketing model
 * name ("MacBook Pro" rather than "Mac16,5") but is slower, so the whole
 * result is cached for the lifetime of the app. Nothing here is sensitive:
 * the serial number and hardware UUID are deliberately never read.
 */

const run = promisify(execFile)
const SYSCTL = '/usr/sbin/sysctl'
const SYSTEM_PROFILER = '/usr/sbin/system_profiler'

let cached: SystemInfo | null = null
let inflight: Promise<SystemInfo> | null = null

async function sysctl(key: string): Promise<string | null> {
  try {
    const { stdout } = await run(SYSCTL, ['-n', key], { timeout: 2000 })
    const value = stdout.trim()
    return value.length > 0 ? value : null
  } catch {
    return null
  }
}

async function sysctlNumber(key: string): Promise<number | null> {
  const raw = await sysctl(key)
  if (raw === null) return null
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : null
}

interface HardwareProfile {
  machineName?: string
  chip?: string
}

async function hardwareProfile(): Promise<HardwareProfile> {
  try {
    const { stdout } = await run(SYSTEM_PROFILER, ['SPHardwareDataType', '-json'], {
      timeout: 4000,
      maxBuffer: 1024 * 1024
    })
    const parsed = JSON.parse(stdout) as {
      SPHardwareDataType?: Array<Record<string, unknown>>
    }
    const row = parsed.SPHardwareDataType?.[0]
    if (!row) return {}
    const text = (key: string): string | undefined => {
      const value = row[key]
      return typeof value === 'string' && value.length > 0 ? value : undefined
    }
    return { machineName: text('machine_name'), chip: text('chip_type') }
  } catch {
    // system_profiler unavailable or timed out — sysctl fallbacks cover us.
    return {}
  }
}

/** Best-effort friendly family from the model identifier. */
function friendlyModel(identifier: string | null): string {
  if (!identifier) return 'Mac'
  const families: Array<[string, string]> = [
    ['MacBookPro', 'MacBook Pro'],
    ['MacBookAir', 'MacBook Air'],
    ['Macmini', 'Mac mini'],
    ['MacStudio', 'Mac Studio'],
    ['MacPro', 'Mac Pro'],
    ['iMac', 'iMac'],
    ['VirtualMac', 'Virtual Mac']
  ]
  for (const [prefix, name] of families) {
    if (identifier.startsWith(prefix)) return name
  }
  return 'Mac'
}

function osVersionLabel(): string {
  let raw = ''
  try {
    // Electron's own macOS marketing version, e.g. "26.1.0".
    raw = process.getSystemVersion()
  } catch {
    raw = os.release()
  }
  const parts = raw.split('.').filter(Boolean)
  return parts.slice(0, 2).join('.') || raw || '—'
}

async function collect(): Promise<SystemInfo> {
  const [identifier, profile, physicalCores, perfCores, efficiencyCores, brand] =
    await Promise.all([
      sysctl('hw.model'),
      hardwareProfile(),
      sysctlNumber('hw.physicalcpu'),
      sysctlNumber('hw.perflevel0.physicalcpu'),
      sysctlNumber('hw.perflevel1.physicalcpu'),
      sysctl('machdep.cpu.brand_string')
    ])

  const fallbackChip = os.cpus()[0]?.model?.trim() || 'Unknown chip'

  return {
    modelName: profile.machineName ?? friendlyModel(identifier),
    modelIdentifier: identifier ?? '',
    chip: profile.chip ?? brand ?? fallbackChip,
    osVersion: osVersionLabel(),
    totalCores: physicalCores ?? os.cpus().length,
    performanceCores: perfCores,
    efficiencyCores: efficiencyCores,
    memoryBytes: os.totalmem(),
    architecture: process.arch
  }
}

/** Cached hardware summary (the profile scan runs at most once per launch). */
export async function getSystemInfo(): Promise<SystemInfo> {
  if (cached) return cached
  if (inflight) return inflight
  inflight = collect()
    .then((info) => {
      cached = info
      return info
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}