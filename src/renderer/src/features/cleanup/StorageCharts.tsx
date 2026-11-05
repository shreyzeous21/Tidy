import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis
} from 'recharts'
import { formatBytes, baseName } from '@/lib/format'
import { DOWNLOAD_CATEGORY_LABELS } from '@shared/constants/categories'
import type { FolderSizeRow } from '@shared/types/info'

/** Series colors come from the theme tokens so light/dark stay in sync. */
export const SERIES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)'
]

type CategoryRow = { category: string; bytes: number }

function categoryLabel(category: string): string {
  return DOWNLOAD_CATEGORY_LABELS[category as keyof typeof DOWNLOAD_CATEGORY_LABELS] ?? category
}

interface TipItem {
  name?: string
  value?: number | string
  payload?: { name?: string }
}

/** Compact tooltip that matches the app's popover chrome. */
export function ChartTip({
  active,
  payload,
  total
}: {
  active?: boolean
  payload?: TipItem[]
  total?: number
}) {
  const item = payload?.[0]
  if (!active || !item) return null
  const value = Number(item.value ?? 0)
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <p className="font-medium">{item.payload?.name ?? item.name}</p>
      <p className="text-muted-foreground">
        {formatBytes(value)}
        {total && total > 0 ? ` · ${Math.round((value / total) * 100)}%` : ''}
      </p>
    </div>
  )
}

/** Donut of disk usage by file category, with a readable legend beside it. */
export function CategoryDonut({
  categories,
  title = 'By category'
}: {
  categories: CategoryRow[]
  title?: string
}) {
  const data = useMemo(
    () =>
      [...categories]
        .filter((row) => row.bytes > 0)
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, SERIES.length)
        .map((row, index) => ({
          name: categoryLabel(row.category),
          value: row.bytes,
          fill: SERIES[index % SERIES.length]
        })),
    [categories]
  )

  const total = useMemo(() => data.reduce((sum, row) => sum + row.value, 0), [data])

  if (data.length === 0) return null

  return (
    <section className="rounded-xl border border-border bg-card/40 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <span className="text-[11px] text-muted-foreground">
          {data.length} types · {formatBytes(total)}
        </span>
      </header>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative mx-auto size-[172px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius="66%"
                outerRadius="96%"
                paddingAngle={2}
                stroke="none"
                startAngle={90}
                endAngle={-270}
              >
                {data.map((row) => (
                  <Cell key={row.name} fill={row.fill} />
                ))}
              </Pie>
              <ChartTooltip content={<ChartTip total={total} />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
              Total
            </span>
            <span className="text-[17px] font-semibold tabular-nums">{formatBytes(total)}</span>
          </div>
        </div>
        <ul className="min-w-0 flex-1 space-y-1.5">
          {data.map((row) => (
            <li key={row.name} className="flex items-center gap-2 text-xs">
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.fill }} />
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatBytes(row.value)}
              </span>
              <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground/70">
                {Math.round((row.value / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** Horizontal bars for the heaviest folders; clicking a bar opens it. */
export function BiggestFoldersChart({
  folders,
  onOpen
}: {
  folders: FolderSizeRow[]
  onOpen: (path: string) => void
}) {
  const data = useMemo(
    () =>
      folders.slice(0, 8).map((folder) => {
        const name = baseName(folder.path) || folder.path
        return {
          name: name.length > 18 ? `${name.slice(0, 17)}…` : name,
          path: folder.path,
          value: folder.bytes
        }
      }),
    [folders]
  )

  if (data.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-card/40 p-4">
        <h3 className="text-[13px] font-semibold">Biggest folders</h3>
        <p className="mt-2 text-xs text-muted-foreground">No folders found under this root.</p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-border bg-card/40 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold">Biggest folders</h3>
        <span className="text-[11px] text-muted-foreground">Click a bar to open</span>
      </header>
      <div style={{ height: Math.max(140, data.length * 38) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
            barCategoryGap={10}
          >
            <defs>
              <linearGradient id="tidy-folder-bar" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.45} />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.95} />
              </linearGradient>
            </defs>
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
              width={112}
              interval={0}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: 'var(--foreground)' }}
            />
            <ChartTooltip cursor={{ fill: 'var(--muted)', opacity: 0.6 }} content={<ChartTip />} />
            <Bar
              dataKey="value"
              fill="url(#tidy-folder-bar)"
              radius={[4, 6, 6, 4]}
              maxBarSize={16}
              className="cursor-pointer"
              onClick={(entry) => {
                const path: string | undefined = entry.payload?.path
                if (path) onOpen(path)
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}