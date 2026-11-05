import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import type { FileEntry, FileKind } from '@shared/types/files'
import type { SearchOptions, SearchResponse } from '@shared/types/search'
import { extensionOf, kindForFile } from '@shared/constants/categories'
import { AppError } from '../utils/errors'

/**
 * Search service.
 *
 * Primary engine: macOS Spotlight via `mdfind`, invoked with a *fixed*
 * executable and argv-array arguments — user input is never interpolated
 * into a shell string, so no injection is possible.
 *
 * Fallback: a bounded local walk of the chosen folder (used when mdfind is
 * unavailable or fails). Structured filters (kind/size/date) are applied to
 * results from either engine by stat-ing a bounded number of hits.
 */

const MDFIND_PATH = '/usr/bin/mdfind'
const RESULT_CAP = 300
const STAT_CAP = 400
const LOCAL_WALK_MAX_FILES = 20_000
const LOCAL_WALK_MAX_DEPTH = 8

/** Directories never worth walking in the fallback engine. */
const SKIP_DIR_NAMES = new Set([
  'node_modules', '.git', '.svn', 'Library', '.Trash', 'Library_Caches',
  'Caches', '.npm', '.cache', '__pycache__', '.venv', 'venv', 'DerivedData'
])

export function mdfindAvailable(): boolean {
  try {
    accessSync(MDFIND_PATH, constants.X_OK)
    return true
  } catch {
    return false
  }
}

interface ParsedQuery {
  term: string
  extensions: string[]
  minSizeBytes?: number
  maxSizeBytes?: number
}

const SIZE_RE = /(?:larger than|bigger than|over|more than|>|above)\s*(\d+(?:\.\d+)?)\s*(kb|mb|gb|k|m|g)\b/gi
const SMALLER_RE = /(?:smaller than|less than|under|<|below)\s*(\d+(?:\.\d+)?)\s*(kb|mb|gb|k|m|g)\b/gi

/** Spoken-word kinds for `type:` operators. */
const KIND_WORDS: Record<string, FileKind> = {
  doc: 'document', docs: 'document', document: 'document', documents: 'document',
  image: 'image', images: 'image', photo: 'image', photos: 'image', picture: 'image', pictures: 'image',
  video: 'video', videos: 'video', movie: 'video', movies: 'video',
  audio: 'audio', music: 'audio', song: 'audio', songs: 'audio',
  archive: 'archive', archives: 'archive', zip: 'archive', zips: 'archive',
  installer: 'installer', installers: 'installer', app: 'installer', apps: 'installer',
  code: 'code', source: 'code'
}

function sizeToBytes(value: number, unit: string): number {
  const u = unit.toLowerCase()
  const mult = u.startsWith('k') ? 1024 : u.startsWith('m') ? 1024 ** 2 : 1024 ** 3
  return Math.round(value * mult)
}

/**
 * Translate the supported subset of natural phrasing and operator tokens
 * into structured filters:
 *   type:image   ext:png,jpg   size:>20mb   size:<1gb   name:invoice
 * Everything else stays as the filename term. The UI surfaces what was
 * understood so we never overclaim understanding.
 */
export function parseQuery(query: string): ParsedQuery {
  const extensions: string[] = []
  let minSizeBytes: number | undefined
  let maxSizeBytes: number | undefined
  const rest: string[] = []

  for (const rawToken of query.split(/\s+/)) {
    if (!rawToken) continue
    const token = rawToken.toLowerCase()
    let m: RegExpExecArray | null

    if ((m = /^type:(\w+)$/.exec(token))) {
      const word = m[1]
      if (isKnownExtension(word)) {
        extensions.push(word)
      } else if (KIND_WORDS[word]) {
        // Type words map to their typical extensions and carry no name term.
        extensions.push(...kindsForKinds([KIND_WORDS[word]]))
      } else {
        rest.push(rawToken)
      }
      continue
    }
    if ((m = /^ext:([\w.]+(?:,[\w.]+)*)$/.exec(token))) {
      for (const part of m[1].split(',')) {
        const clean = part.replace(/^\./, '')
        if (clean) extensions.push(clean)
      }
      continue
    }
    if ((m = /^size:>(\d+(?:\.\d+)?)(kb|mb|gb|k|m|g)$/.exec(token))) {
      minSizeBytes = sizeToBytes(parseFloat(m[1]), m[2])
      continue
    }
    if ((m = /^size:<(\d+(?:\.\d+)?)(kb|mb|gb|k|m|g)$/.exec(token))) {
      maxSizeBytes = sizeToBytes(parseFloat(m[1]), m[2])
      continue
    }
    if ((m = /^name:(.+)$/.exec(token))) {
      rest.push(m[1])
      continue
    }
    rest.push(rawToken)
  }

  let term = rest.join(' ')

  // Natural phrases ("larger than 20 mb") still work on the remaining words.
  for (const re of [SIZE_RE, SMALLER_RE]) {
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(term)) !== null) {
      const bytes = sizeToBytes(parseFloat(match[1]), match[2])
      if (re === SIZE_RE) minSizeBytes = bytes
      else maxSizeBytes = bytes
    }
  }
  term = term.replace(SIZE_RE, ' ').replace(SMALLER_RE, ' ')

  // Known kind words ("pdf files", "pngs", ".docx") become extension filters.
  const extMatches = term.matchAll(/\b\.?([a-z0-9]{1,6})s?\b/gi)
  for (const m of extMatches) {
    const candidate = m[1].toLowerCase()
    if (isKnownExtension(candidate)) {
      extensions.push(candidate)
      term = term.replace(new RegExp(`\\b\\.?${m[1]}s?\\b`, 'gi'), ' ')
    }
  }

  return { term: term.replace(/\s+/g, ' ').trim(), extensions, minSizeBytes, maxSizeBytes }
}

const KNOWN_EXTENSIONS = new Set(
  [
    'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'txt', 'md',
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg', 'tiff', 'psd',
    'mp4', 'mov', 'mkv', 'avi', 'webm',
    'mp3', 'wav', 'aac', 'flac', 'm4a',
    'zip', 'rar', '7z', 'tar', 'gz',
    'dmg', 'pkg', 'iso', 'exe',
    'ts', 'tsx', 'js', 'json', 'html', 'css', 'py'
  ]
)

function isKnownExtension(ext: string): boolean {
  return KNOWN_EXTENSIONS.has(ext)
}

function mdfindExec(args: string[], timeoutMs = 6000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      MDFIND_PATH,
      args,
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, shell: false },
      (error, stdout) => {
        if (error && stdout.length === 0) {
          reject(error)
          return
        }
        resolve(stdout.split('\n').filter((line) => line.length > 0))
      }
    )
  })
}

export async function searchFiles(options: SearchOptions): Promise<SearchResponse> {
  const parsed = parseQuery(options.query ?? '')
  const merged: Required<Pick<SearchOptions, 'query'>> & SearchOptions = {
    ...options,
    minSizeBytes: options.minSizeBytes ?? parsed.minSizeBytes,
    maxSizeBytes: options.maxSizeBytes ?? parsed.maxSizeBytes
  }
  const allExtensions = [...parsed.extensions]
  if (merged.kinds?.length) {
    // Kind filters map onto their typical extensions for filename-based engines.
    allExtensions.push(...kindsForKinds(merged.kinds))
  }

  const hints: string[] = []
  if (allExtensions.length) hints.push(`type: ${allExtensions.join(', ')}`)
  if (merged.minSizeBytes) hints.push(`larger than ${humanSize(merged.minSizeBytes)}`)
  if (merged.maxSizeBytes) hints.push(`smaller than ${humanSize(merged.maxSizeBytes)}`)
  if (merged.modifiedWithinDays) hints.push(`modified within ${merged.modifiedWithinDays} day(s)`)

  const location = merged.location ? path.resolve(merged.location) : os.homedir()
  const effectiveTerm = parsed.term

  if (!effectiveTerm) {
    // Filters only, no name term → the local engine handles it (Spotlight raw
    // queries are out of scope; we are honest about that).
    const entries = await localSearch('', allExtensions, location, merged)
    return { results: entries.slice(0, RESULT_CAP), source: 'local', truncated: entries.length > RESULT_CAP, parsedHints: hints }
  }

  let rawPaths: string[]
  let source: SearchResponse['source']

  // Content search is Spotlight-only and honest about it.
  if (merged.includeContents) {
    if (!mdfindAvailable()) {
      throw new AppError(
        'MD_FIND_UNAVAILABLE',
        'Searching inside files needs macOS Spotlight (mdfind), which is not available. Filename search still works.'
      )
    }
    if (!effectiveTerm) {
      throw new AppError('INVALID_INPUT', 'Enter a search term to look inside files.')
    }
    // Strip characters with meaning in Spotlight query syntax. The query is a
    // single argv element — never a shell string — so this is about syntax,
    // not injection.
    const safeTerm = effectiveTerm.replace(/["\\()*]/g, ' ').trim()
    if (!safeTerm) {
      throw new AppError('INVALID_INPUT', 'That search term has no usable words for content search.')
    }
    const rawQuery = `(kMDItemTextContent = "*${safeTerm}*"cdw)`
    try {
      rawPaths = await mdfindExec(['-onlyin', location, rawQuery], 12_000)
      source = 'spotlight'
    } catch (error) {
      console.error('[tidy] mdfind content search failed:', error)
      rawPaths = []
      source = 'spotlight'
    }
  } else if (mdfindAvailable()) {
    try {
      rawPaths = await mdfindExec(['-onlyin', location, '-name', effectiveTerm])
      source = 'spotlight'
    } catch (error) {
      console.error('[tidy] mdfind failed, falling back to local walk:', error)
      rawPaths = await localWalkNames(location, effectiveTerm.toLowerCase())
      source = 'local'
    }
  } else {
    rawPaths = await localWalkNames(location, effectiveTerm.toLowerCase())
    source = 'local'
  }

  // Stat bounded hits and apply structured filters.
  const statTargets = rawPaths.slice(0, STAT_CAP)
  const entries: FileEntry[] = []
  for (const p of statTargets) {
    try {
      const stat = await fsp.lstat(p)
      const name = path.basename(p)
      const isDirectory = stat.isDirectory()
      const size = stat.isFile() ? stat.size : 0
      const ext = extensionOf(name)
      if (allExtensions.length > 0 && !isDirectory && !allExtensions.includes(ext)) continue
      if (merged.minSizeBytes !== undefined && size < merged.minSizeBytes) continue
      if (merged.maxSizeBytes !== undefined && size > merged.maxSizeBytes) continue
      if (merged.modifiedWithinDays !== undefined) {
        const cutoff = Date.now() - merged.modifiedWithinDays * 24 * 60 * 60 * 1000
        if (stat.mtimeMs < cutoff) continue
      }
      entries.push({
        name,
        path: p,
        isDirectory,
        isSymlink: stat.isSymbolicLink(),
        size,
        modifiedAt: Math.floor(stat.mtimeMs),
        kind: kindForFile(name, isDirectory),
        extension: isDirectory ? '' : ext
      })
      if (entries.length >= RESULT_CAP) break
    } catch {
      // Item vanished or unreadable between query and stat — skip it.
    }
  }

  entries.sort((a, b) => b.modifiedAt - a.modifiedAt)
  return {
    results: entries,
    source,
    truncated: rawPaths.length > STAT_CAP || entries.length >= RESULT_CAP,
    parsedHints: hints
  }
}

function kindsForKinds(kinds: FileKind[]): string[] {
  const map: Partial<Record<FileKind, string[]>> = {
    document: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'md'],
    image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg'],
    video: ['mp4', 'mov', 'mkv', 'avi'],
    audio: ['mp3', 'wav', 'aac', 'flac', 'm4a'],
    archive: ['zip', 'rar', '7z', 'tar', 'gz'],
    installer: ['dmg', 'pkg', 'iso']
  }
  const out: string[] = []
  for (const k of kinds) out.push(...(map[k] ?? []))
  return out
}

function humanSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes % (1024 ** 3) === 0 ? 0 : 1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(bytes % (1024 ** 2) === 0 ? 0 : 1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

/** Fallback: BFS walk collecting files whose name contains the term. */
async function localWalkNames(root: string, termLower: string): Promise<string[]> {
  const out: string[] = []
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  while (queue.length > 0 && out.length < LOCAL_WALK_MAX_FILES) {
    const { dir, depth } = queue.shift()!
    let dirents
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const dirent of dirents) {
      if (out.length >= LOCAL_WALK_MAX_FILES) break
      const full = path.join(dir, dirent.name)
      if (dirent.isDirectory()) {
        if (depth < LOCAL_WALK_MAX_DEPTH && !SKIP_DIR_NAMES.has(dirent.name)) {
          queue.push({ dir: full, depth: depth + 1 })
        }
      } else if (termLower === '' || dirent.name.toLowerCase().includes(termLower)) {
        out.push(full)
      }
    }
  }
  return out
}

/** Filters-only local search (no term). */
async function localSearch(
  term: string,
  extensions: string[],
  location: string,
  merged: SearchOptions
): Promise<FileEntry[]> {
  if (!extensions.length && merged.minSizeBytes === undefined && merged.maxSizeBytes === undefined && !merged.modifiedWithinDays) {
    throw new AppError('INVALID_INPUT', 'Enter a filename or pick at least one filter.')
  }
  const paths = await localWalkNames(location, term.toLowerCase())
  const entries: FileEntry[] = []
  for (const p of paths.slice(0, STAT_CAP)) {
    try {
      const stat = await fsp.lstat(p)
      const name = path.basename(p)
      const isDirectory = stat.isDirectory()
      const size = stat.isFile() ? stat.size : 0
      const ext = extensionOf(name)
      if (extensions.length && !isDirectory && !extensions.includes(ext)) continue
      if (merged.minSizeBytes !== undefined && size < merged.minSizeBytes) continue
      if (merged.maxSizeBytes !== undefined && size > merged.maxSizeBytes) continue
      if (merged.modifiedWithinDays !== undefined) {
        const cutoff = Date.now() - merged.modifiedWithinDays * 24 * 60 * 60 * 1000
        if (stat.mtimeMs < cutoff) continue
      }
      entries.push({
        name,
        path: p,
        isDirectory,
        isSymlink: stat.isSymbolicLink(),
        size,
        modifiedAt: Math.floor(stat.mtimeMs),
        kind: kindForFile(name, isDirectory),
        extension: isDirectory ? '' : ext
      })
      if (entries.length >= RESULT_CAP) break
    } catch {
      continue
    }
  }
  entries.sort((a, b) => b.modifiedAt - a.modifiedAt)
  return entries
}
