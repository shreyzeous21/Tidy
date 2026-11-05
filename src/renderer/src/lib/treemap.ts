export interface TreemapItem {
  name: string
  path: string
  bytes: number
}

export interface LaidOutItem extends TreemapItem {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Squarified treemap layout (Bruls et al.) — pure, unit-testable.
 * Greedy row placement minimizing the worst aspect ratio.
 */
export function squarify(items: TreemapItem[], width: number, height: number): LaidOutItem[] {
  const total = items.reduce((sum, item) => sum + item.bytes, 0)
  if (total <= 0 || width <= 0 || height <= 0) return []
  const sorted = [...items].filter((i) => i.bytes > 0).sort((a, b) => b.bytes - a.bytes)
  const canvas = width * height

  const laid: LaidOutItem[] = []
  const rect = { x: 0, y: 0, w: width, h: height }
  let row: Array<{ item: TreemapItem; area: number }> = []

  const rowSum = (row2: Array<{ area: number }>): number => row2.reduce((sum, r) => sum + r.area, 0)
  const worst = (row2: Array<{ area: number }>, side: number): number => {
    const sum = rowSum(row2)
    if (sum <= 0 || side <= 0) return Infinity
    let worstRatio = 0
    for (const r of row2) {
      const ratio = Math.max((side * side * r.area) / (sum * sum), (sum * sum) / (side * side * r.area))
      worstRatio = Math.max(worstRatio, ratio)
    }
    return worstRatio
  }
  const layoutRow = (): void => {
    if (row.length === 0 || rect.w <= 0 || rect.h <= 0) {
      row = []
      return
    }
    const area = rowSum(row)
    const horizontal = rect.w >= rect.h
    if (horizontal) {
      const stripW = area / rect.h
      let y = rect.y
      for (const r of row) {
        const h = r.area / stripW
        laid.push({ ...r.item, x: rect.x, y, w: stripW, h })
        y += h
      }
      rect.x += stripW
      rect.w -= stripW
    } else {
      const stripH = area / rect.w
      let x = rect.x
      for (const r of row) {
        const w = r.area / stripH
        laid.push({ ...r.item, x, y: rect.y, w, h: stripH })
        x += w
      }
      rect.y += stripH
      rect.h -= stripH
    }
    row = []
  }

  for (const item of sorted) {
    const area = (item.bytes / total) * canvas
    if (rect.w <= 0 || rect.h <= 0) break
    const side = Math.min(rect.w, rect.h)
    if (row.length === 0) {
      row.push({ item, area })
      continue
    }
    const withItem = [...row, { item, area }]
    if (worst(withItem, side) <= worst(row, side)) {
      row.push({ item, area })
    } else {
      layoutRow()
      row.push({ item, area })
    }
  }
  layoutRow()

  return laid
}
