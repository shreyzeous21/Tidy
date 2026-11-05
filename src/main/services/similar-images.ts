import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SimilarImageGroup } from '@shared/types/cleanup'
import { AppError } from '../utils/errors'
import { decodePng, dHash64, hammingDistance } from './image-hash'

/**
 * Similar image finder using 64-bit perceptual hashing (dHash).
 * Thumbnails are produced by the system `sips` binary (fixed path, argv
 * array only) and decoded by Tidy's own minimal PNG decoder — no image
 * libraries, nothing leaves the machine.
 */

const SIPS = '/usr/bin/sips'
const THUMB = 24
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'bmp', 'gif'])
const MIN_SIZE = 48 * 1024
const MAX_IMAGES = 1200
const HAMMING_THRESHOLD = 6

function sipsResize(source: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(SIPS, ['-Z', String(THUMB), '-s', 'format png', source, '--out', dest], { shell: false, timeout: 10_000 }, (error) => {
      if (error) reject(new AppError('UNKNOWN', 'sips failed'))
      else resolve()
    })
  })
}

export async function findSimilarImages(
  root: string,
  isCancelled: () => boolean,
  onProgress: (processed: number, currentPath: string) => void
): Promise<SimilarImageGroup[]> {
  // Collect image files.
  const images: Array<{ path: string; name: string; size: number }> = []
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  const SKIP = new Set(['node_modules', '.git', '.Trash', 'Library'])
  let visited = 0
  while (queue.length > 0 && images.length < MAX_IMAGES) {
    if (isCancelled()) throw new AppError('CANCELLED', 'Scan cancelled.')
    const { dir, depth } = queue.shift()!
    if (++visited > 30_000) break
    let dirents
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const dirent of dirents) {
      const full = path.join(dir, dirent.name)
      if (dirent.isDirectory()) {
        if (depth < 8 && !SKIP.has(dirent.name)) queue.push({ dir: full, depth: depth + 1 })
      } else if (dirent.isFile()) {
        const ext = dirent.name.split('.').pop()?.toLowerCase() ?? ''
        if (!IMAGE_EXTS.has(ext)) continue
        const stat = await fsp.stat(full).then((s) => s.size, () => 0)
        if (stat >= MIN_SIZE) images.push({ path: full, name: dirent.name, size: stat })
        if (images.length >= MAX_IMAGES) break
      }
    }
  }

  // Hash each image via sips thumbnail + local decode.
  const tmpDir = path.join(os.tmpdir(), `tidy-dhash-${randomUUID()}`)
  await fsp.mkdir(tmpDir, { recursive: true })
  const hashed: Array<{ path: string; name: string; size: number; hash: string }> = []
  try {
    for (let index = 0; index < images.length; index++) {
      if (isCancelled()) throw new AppError('CANCELLED', 'Scan cancelled.')
      const image = images[index]
      onProgress(index + 1, image.path)
      const thumb = path.join(tmpDir, `${index}.png`)
      try {
        await sipsResize(image.path, thumb)
        const png = await fsp.readFile(thumb)
        const decoded = decodePng(png)
        hashed.push({ ...image, hash: dHash64(decoded) })
      } catch {
        // undecodable/unconvertible image — skip it
      }
    }
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }

  // Group by hamming distance to a representative hash.
  hashed.sort((a, b) => a.hash.localeCompare(b.hash))
  const groups: SimilarImageGroup[] = []
  const used = new Set<number>()
  for (let i = 0; i < hashed.length; i++) {
    if (used.has(i)) continue
    const group = [hashed[i]]
    used.add(i)
    for (let j = i + 1; j < hashed.length; j++) {
      if (used.has(j)) continue
      if (hammingDistance(hashed[i].hash, hashed[j].hash) <= HAMMING_THRESHOLD) {
        group.push(hashed[j])
        used.add(j)
      }
    }
    if (group.length > 1) {
      groups.push({ hash: hashed[i].hash, images: group.map(({ path: p, name, size }) => ({ path: p, name, size })) })
    }
  }
  groups.sort((a, b) => b.images.length - a.images.length)
  return groups.slice(0, 200)
}
