import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis
} from 'recharts'
import { formatBytes } from '@/lib/format'
import { SERIES } from '../cleanup/StorageCharts'
import type { VolumeUsage } from '@shared/types/info'
import type { OperationHistoryItem } from '@shared/types/settings'

/**
 * Overview dashboard charts. Series colors come from the shared theme tokens
 * so everything stays in sync with light/dark mode.
 */

/** Radial gauge for a single volume's usage. */
export function VolumeGauge({ volume }: { volume: VolumeUsage }) {
  const usedPct =
    volume.total > 0 ? Math.min(100, Math.round((volume.used / volume.total) * 100)) : 0
  const tone =
    usedPct >= 90 ? 'var(--destructive)' : usedPct >= 75 ? 'var(--chart-5)' : 'var(--chart-1)'
  const data = [{ name: 'used', value: usedPct }]

  return (
    <div className="flex items-center gap-4">
      <div className="relative size-[148px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            innerRadius="74%"
            outerRadius="100%"
            data={data}
            startAngle={90}
            endAngle={-270}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar dataKey="value" background={{ fill: 'var(--muted)' }} cornerRadius={20} fill={tone} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[20px] font-semibold tabular-nums">{usedPct}%</span>
          <span className="text-[11px] text-muted-foreground">used</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tone }} />
          <span className="text-muted-foreground">Used</span>
          <span className="ml-auto tabular-nums">{formatBytes(volume.used)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-muted" />
          <span className="text-muted-foreground">Free</span>
          <span className="ml-auto tabular-nums">{formatBytes(volume.free)}</span>
        </div>
        <div className="flex items-center gap-2 border-t border-border/60 pt-1.5 text-[11px] text-muted-foreground">
          <span className="truncate" title={volume.path}>
            {volume.name}
          </span>
          <span className="ml-auto shrink-0 tabular-nums">{formatBytes(volume.total)}</span>
        </div>
      </div>
    </div>
  )
}

interface ActivityBucket {
  ts: number
  label: string
  rename: number
  move: number
  trash: number
}

function ActivityTip({
  active,
  payload,
  label
}: {
  active?: boolean
  payload?: Array<{ dataKey?: string | number; value?: number | string }>
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null
  const rows = payload.filter((entry) => Number(entry.value ?? 0) > 0)
  if (rows.length === 0) return null
  const names: Record<string, string> = { rename: 'Renamed', move: 'Moved', trash: 'Trashed' }
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <p className="font-medium">{label}</p>
      {rows.map((entry) => (
        <p key={String(entry.dataKey)} className="text-muted-foreground">
          {names[String(entry.dataKey)] ?? String(entry.dataKey)}: {Number(entry.value)}
        </p>
      ))}
    </div>
  )
}

/** Stacked bars of Tidy actions over the last two weeks, from local history. */
export function ActivityChart({ history }: { history: OperationHistoryItem[] }) {
  const DAYS = 14
  const data = useMemo<ActivityBucket[]>(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - (DAYS - 1))
    const buckets: ActivityBucket[] = Array.from({ length: DAYS }, (_, index) => {
      const day = new Date(start)
      day.setDate(start.getDate() + index)
      return {
        ts: day.getTime(),
        label: `${day.getMonth() + 1}/${day.getDate()}`,
        rename: 0,
        move: 0,
        trash: 0
      }
    })
    for (const item of history) {
      const at = Date.parse(item.at)
      if (!Number.isFinite(at)) continue
      const day = new Date(at)
      day.setHours(0, 0, 0, 0)
      const bucket = buckets.find((entry) => entry.ts === day.getTime())
      if (!bucket) continue
      bucket[item.type] += item.count || 1
    }
    return buckets
  }, [history])

  const total = useMemo(
    () => data.reduce((sum, entry) => sum + entry.rename + entry.move + entry.trash, 0),
    [data]
  )

  return (
    <section className="rounded-xl border border-border bg-card/40 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold">Activity</h3>
        <span className="text-[11px] text-muted-foreground">
          {total === 0 ? 'Last 14 days' : `${total} actions · last 14 days`}
        </span>
      </header>
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }} barCategoryGap={4}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval={1}
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
            />
            <YAxis
              allowDecimals={false}
              width={28}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
            />
            <ChartTooltip cursor={{ fill: 'var(--muted)', opacity: 0.5 }} content={<ActivityTip />} />
            <Bar dataKey="move" stackId="a" fill="var(--chart-1)" maxBarSize={18} />
            <Bar dataKey="rename" stackId="a" fill="var(--chart-2)" maxBarSize={18} />
            <Bar dataKey="trash" stackId="a" fill="var(--chart-6)" radius={[5, 5, 0, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {[
          ['Moved', 'var(--chart-1)'],
          ['Renamed', 'var(--chart-2)'],
          ['Trashed', 'var(--chart-6)']
        ].map(([label, color]) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
      </div>
    </section>
  )
}

interface VolumeRow {
  name: string
  value: number
  total: number
}

function VolumeTip({
  active,
  payload
}: {
  active?: boolean
  payload?: Array<{ payload?: VolumeRow }>
}) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  const pct = row.total > 0 ? Math.round((row.value / row.total) * 100) : 0
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <p className="font-medium">{row.name}</p>
      <p className="text-muted-foreground">
        {formatBytes(row.value)} used of {formatBytes(row.total)} · {pct}%
      </p>
    </div>
  )
}

/** Horizontal bars comparing used space across mounted volumes. */
export function VolumesChart({ volumes }: { volumes: VolumeUsage[] }) {
  const data = useMemo<VolumeRow[]>(
    () =>
      volumes
        .filter((volume) => volume.total > 0)
        .sort((a, b) => b.used - a.used)
        .map((volume) => ({ name: volume.name, value: volume.used, total: volume.total })),
    [volumes]
  )

  if (data.length < 2) return null

  return (
    <section className="rounded-xl border border-border bg-card/40 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold">Volumes</h3>
        <span className="text-[11px] text-muted-foreground">Used space</span>
      </header>
      <div style={{ height: Math.max(120, data.length * 44) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
            barCategoryGap={12}
          >
            <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 4" />
            <XAxis
              type="number"
              tickFormatter={(value: number) => (value === 0 ? '0' : formatBytes(value))}
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={96}
              interval={0}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: 'var(--foreground)' }}
            />
            <ChartTooltip cursor={{ fill: 'var(--muted)', opacity: 0.6 }} content={<VolumeTip />} />
            <Bar dataKey="value" fill={SERIES[0]} radius={[4, 6, 6, 4]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
