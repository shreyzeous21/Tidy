import type { DownloadCategory, FileEntry } from '@shared/types/files'
import type { OrgRule } from '@shared/types/settings'
import { categoryForFile } from '@shared/constants/categories'

/**
 * Pure rule matching for Downloads organizing. First matching enabled rule
 * wins; rules only ever *suggest* destinations — nothing moves without an
 * explicit user confirmation downstream.
 */
export function matchRule(file: FileEntry, rules: OrgRule[]): OrgRule | null {
  const name = file.name.toLowerCase()
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (rule.category !== 'any' && categoryForFile(file.name) !== (rule.category as DownloadCategory)) {
      continue
    }
    if (rule.nameContains && !name.includes(rule.nameContains.toLowerCase())) continue
    return rule
  }
  return null
}

/** Destination for a file: matching rule first, then the category default. */
export function destinationFor(
  file: FileEntry,
  rules: OrgRule[],
  categoryDefaults: Record<string, string | null | undefined>
): { destination: string | null; fromRule: boolean } {
  const rule = matchRule(file, rules)
  if (rule) return { destination: rule.destination, fromRule: true }
  const fallback = categoryDefaults[categoryForFile(file.name)]
  return { destination: fallback ?? null, fromRule: false }
}
