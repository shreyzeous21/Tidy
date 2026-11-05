import type { FileEntry } from '@shared/types/files'

/**
 * Bulk rename planner — a pure function so it can be unit-tested.
 * Given the selected entries, a rename mode, and the set of names already
 * present in the folder, produces one plan row per entry.
 */

export type RenameMode = 'replace' | 'prefix' | 'suffix' | 'number' | 'extension'

export interface BulkRenameOptions {
  mode: RenameMode
  /** replace: substring to find. */
  find: string
  /** replace: replacement text. */
  replaceWith: string
  /** prefix / number: text before the name. */
  prefix: string
  /** suffix: text inserted before the extension. */
  suffix: string
  /** number: first index. */
  startNumber: number
  /** number: zero padding width. */
  pad: number
  /** extension: new extension (without dot; empty = remove extension). */
  newExtension: string
}

export interface RenamePlanRow {
  entry: FileEntry
  newName: string
  status: 'unchanged' | 'ok' | 'collision'
  /** Why a collision happened (shown in the preview). */
  reason?: string
}

const INVALID = ['/', ':', '\0']

function splitName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return { base: name, ext: '' }
  return { base: name.slice(0, dot), ext: name.slice(dot) }
}

export function planRename(entry: FileEntry, options: BulkRenameOptions, index: number): string {
  const { base, ext } = splitName(entry.name)
  switch (options.mode) {
    case 'replace':
      if (!options.find) return entry.name
      return entry.name.split(options.find).join(options.replaceWith)
    case 'prefix':
      return `${options.prefix}${entry.name}`
    case 'suffix':
      return `${base}${options.suffix}${ext}`
    case 'number': {
      const n = options.startNumber + index
      const padded = String(n).padStart(Math.max(options.pad, 1), '0')
      return `${base} ${padded}${ext}`
    }
    case 'extension': {
      const clean = options.newExtension.replace(/^\./, '')
      return clean ? `${base}.${clean}` : base
    }
  }
}

/**
 * Plan renames for every entry. A row collides when its new name equals an
 * existing item (that isn't itself being renamed away) or another planned
 * name in the same batch.
 */
export function planBulkRename(
  entries: FileEntry[],
  existingNames: Iterable<string>,
  options: BulkRenameOptions
): RenamePlanRow[] {
  const renamedAway = new Set<string>()
  for (const entry of entries) {
    const planned = planRename(entry, options, 0)
    if (planned !== entry.name) renamedAway.add(entry.name)
  }

  const takenByOthers = new Set(existingNames)
  for (const entry of entries) {
    takenByOthers.delete(entry.name)
    // Names that stay constant within the batch still occupy their slot.
    if (planRename(entry, options, 0) === entry.name) takenByOthers.add(entry.name)
  }

  const plannedNames = new Map<string, number>()
  const rows: RenamePlanRow[] = entries.map((entry, index) => {
    const newName = planRename(entry, options, index)
    plannedNames.set(newName, (plannedNames.get(newName) ?? 0) + 1)
    return { entry, newName, status: 'ok' }
  })

  return rows.map((row) => {
    if (row.newName === row.entry.name) {
      return { ...row, status: 'unchanged' as const }
    }
    if (INVALID.some((c) => row.newName.includes(c)) || row.newName.trim().length === 0) {
      return { ...row, status: 'collision' as const, reason: 'Name contains invalid characters.' }
    }
    if (takenByOthers.has(row.newName)) {
      return {
        ...row,
        status: 'collision' as const,
        reason: 'Another item with this name exists in the folder.'
      }
    }
    if ((plannedNames.get(row.newName) ?? 0) > 1) {
      return { ...row, status: 'collision' as const, reason: 'Two items would get the same name.' }
    }
    return row
  })
}
