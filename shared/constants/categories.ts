import type { DownloadCategory, FileKind } from '../types/files'

/** Extension → Downloads category. Longer/more specific extensions first is unnecessary here; exact match only. */
const CATEGORY_EXTENSIONS: Record<Exclude<DownloadCategory, 'other'>, string[]> = {
  documents: [
    'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'tsv', 'txt', 'md',
    'rtf', 'pages', 'numbers', 'key', 'odt', 'ods', 'odp', 'epub'
  ],
  images: [
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'tiff', 'tif', 'bmp',
    'svg', 'ico', 'raw', 'cr2', 'nef', 'arw', 'dng', 'avif', 'psd', 'ai', 'sketch'
  ],
  videos: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv', 'flv', 'mpeg', 'mpg'],
  audio: ['mp3', 'wav', 'aac', 'flac', 'm4a', 'ogg', 'oga', 'aiff', 'aif', 'wma', 'opus'],
  archives: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'tbz2', 'zst'],
  installers: ['dmg', 'pkg', 'app', 'exe', 'msi', 'deb', 'rpm', 'appimage', 'iso']
}

/** Extension → FileKind for browser icons/labels. */
const KIND_EXTENSIONS: Record<Exclude<FileKind, 'folder' | 'other'>, string[]> = {
  document: CATEGORY_EXTENSIONS.documents,
  image: CATEGORY_EXTENSIONS.images,
  video: CATEGORY_EXTENSIONS.videos,
  audio: CATEGORY_EXTENSIONS.audio,
  archive: CATEGORY_EXTENSIONS.archives,
  installer: CATEGORY_EXTENSIONS.installers,
  code: [
    'ts', 'tsx', 'js', 'jsx', 'json', 'html', 'css', 'scss', 'py', 'rb', 'go',
    'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'sh', 'zsh', 'yml', 'yaml', 'toml', 'xml', 'sql'
  ]
}

const EXTENSION_TO_CATEGORY = new Map<string, DownloadCategory>()
for (const [category, exts] of Object.entries(CATEGORY_EXTENSIONS) as Array<
  [Exclude<DownloadCategory, 'other'>, string[]]
>) {
  for (const ext of exts) EXTENSION_TO_CATEGORY.set(ext, category)
}

const EXTENSION_TO_KIND = new Map<string, FileKind>()
for (const [kind, exts] of Object.entries(KIND_EXTENSIONS) as Array<
  [Exclude<FileKind, 'folder' | 'other'>, string[]]
>) {
  for (const ext of exts) EXTENSION_TO_KIND.set(ext, kind)
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

export function categoryForFile(name: string): DownloadCategory {
  return EXTENSION_TO_CATEGORY.get(extensionOf(name)) ?? 'other'
}

export function kindForFile(name: string, isDirectory: boolean): FileKind {
  if (isDirectory) return 'folder'
  return EXTENSION_TO_KIND.get(extensionOf(name)) ?? 'other'
}

/** Friendly kind label for table display. */
export function kindLabel(entry: { isDirectory: boolean; name: string }): string {
  if (entry.isDirectory) return 'Folder'
  const ext = extensionOf(entry.name)
  if (!ext) return 'Document'
  const label = EXTENSION_TO_KIND.get(ext)
  if (!label) return `${ext.toUpperCase()} file`
  switch (label) {
    case 'document':
      return `${ext.toUpperCase()} document`
    case 'image':
      return `${ext.toUpperCase()} image`
    case 'video':
      return `${ext.toUpperCase()} video`
    case 'audio':
      return `${ext.toUpperCase()} audio`
    case 'archive':
      return `${ext.toUpperCase()} archive`
    case 'installer':
      return `${ext.toUpperCase()} installer`
    case 'code':
      return `${ext.toUpperCase()} source`
    default:
      return 'Document'
  }
}

export const DOWNLOAD_CATEGORY_ORDER: DownloadCategory[] = [
  'documents',
  'images',
  'videos',
  'audio',
  'archives',
  'installers',
  'other'
]

export const DOWNLOAD_CATEGORY_LABELS: Record<DownloadCategory, string> = {
  documents: 'Documents',
  images: 'Images',
  videos: 'Videos',
  audio: 'Audio',
  archives: 'Archives',
  installers: 'Installers',
  other: 'Other'
}
