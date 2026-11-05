import fsp from 'node:fs/promises'
import path from 'node:path'
import type { VolumeUsage } from '@shared/types/info'

/** Light statfs-only volume usage for live monitoring (#13). */

export async function volumeUsageOf(): Promise<VolumeUsage[]> {
  const out: VolumeUsage[] = []
  const targets: Array<{ p: string; name: string }> = [{ p: '/', name: 'Macintosh HD' }]
  try {
    const vols = await fsp.readdir('/Volumes', { withFileTypes: true })
    for (const v of vols) {
      if (v.isDirectory() && v.name !== 'Macintosh HD') {
        targets.push({ p: path.join('/Volumes', v.name), name: v.name })
      }
    }
  } catch {
    // /Volumes unreadable
  }
  for (const { p, name } of targets) {
    try {
      const stats = await fsp.statfs(p)
      const blockSize = Number(stats.bsize)
      const total = Number(stats.blocks) * blockSize
      const free = Number(stats.bavail) * blockSize
      out.push({ path: p, name, total, free, used: Math.max(total - free, 0) })
    } catch {
      // unmountable mid-read — skip
    }
  }
  return out
}
