import {
  File,
  FileArchive,
  FileCode,
  FileText,
  Film,
  Folder,
  Image,
  Music,
  Package
} from 'lucide-react'
import type { FileKind } from '@shared/types/files'
import { cn } from 'cn'

const KIND_ICONS: Record<FileKind, typeof File> = {
  folder: Folder,
  document: FileText,
  image: Image,
  video: Film,
  audio: Music,
  archive: FileArchive,
  installer: Package,
  code: FileCode,
  other: File
}

const KIND_COLORS: Record<FileKind, string> = {
  folder: 'text-sky-500 dark:text-sky-400',
  document: 'text-rose-500/80 dark:text-rose-400/90',
  image: 'text-emerald-500/80 dark:text-emerald-400/90',
  video: 'text-violet-500/80 dark:text-violet-400/90',
  audio: 'text-pink-500/80 dark:text-pink-400/90',
  archive: 'text-amber-600/80 dark:text-amber-400/90',
  installer: 'text-teal-600/80 dark:text-teal-400/90',
  code: 'text-indigo-500/80 dark:text-indigo-400/90',
  other: 'text-muted-foreground'
}

/** Small, purposeful file icon keyed by detected kind. */
export function FileIcon({ kind, className }: { kind: FileKind; className?: string }) {
  const Icon = KIND_ICONS[kind]
  return <Icon className={cn('size-4 shrink-0', KIND_COLORS[kind], className)} />
}
