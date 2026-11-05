import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { VolumeUsage } from '@shared/types/info'
import type { UsageSnapshot } from '@shared/types/cleanup'
import type { OperationHistoryItem } from '@shared/types/settings'

/**
 * Storage usage snapshots (for growth tracking) and structured undo records.
 * Snapshots live in a small JSONL file; undo payloads ride on the history.
 */

function historyFile(name: string): string {
  return path.join(app.getPath('userData'), name)
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`
  await fsp.writeFile(tmp, JSON.stringify(value), 'utf8')
  await fsp.rename(tmp, file)
}

// ---------- usage history (#12/#14) ----------

const USAGE_FILE = 'usage-history.json'
const USAGE_LIMIT = 90

export async function recordUsageSnapshot(volumes: VolumeUsage[]): Promise<void> {
  if (volumes.length === 0) return
  const history = await readJson<UsageSnapshot[]>(historyFile(USAGE_FILE), [])
  const today = new Date().toISOString().slice(0, 10)
  const filtered = history.filter((s) => s.at !== today)
  filtered.push({ at: today, volumes: volumes.map((v) => ({ path: v.path, used: v.used, total: v.total })) })
  await writeJsonAtomic(historyFile(USAGE_FILE), filtered.slice(-USAGE_LIMIT))
}

export async function getUsageHistory(): Promise<UsageSnapshot[]> {
  return readJson<UsageSnapshot[]>(historyFile(USAGE_FILE), [])
}

// ---------- structured undo (#42) ----------

/**
 * Undo payloads recorded alongside history entries:
 * - rename: swap from/to
 * - move: move every item back from finalPath to sourcePath
 * (trash/copy/compress are not undoable; trash can be restored in Finder.)
 */
export type UndoPayload =
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'move'; items: Array<{ from: string; to: string }> }

const OPS_FILE = 'ops-undo.json'
const OPS_LIMIT = 100

interface OpRecord {
  id: string
  undo: UndoPayload
  undone: boolean
}

export async function recordUndo(id: string, undo: UndoPayload): Promise<void> {
  const ops = await readJson<OpRecord[]>(historyFile(OPS_FILE), [])
  ops.push({ id, undo, undone: false })
  await writeJsonAtomic(historyFile(OPS_FILE), ops.slice(-OPS_LIMIT))
}

export async function getUndoRecord(id: string): Promise<OpRecord | null> {
  const ops = await readJson<OpRecord[]>(historyFile(OPS_FILE), [])
  return ops.find((op) => op.id === id && !op.undone) ?? null
}

export async function markUndone(id: string): Promise<void> {
  const ops = await readJson<OpRecord[]>(historyFile(OPS_FILE), [])
  const next = ops.map((op) => (op.id === id ? { ...op, undone: true } : op))
  await writeJsonAtomic(historyFile(OPS_FILE), next)
}

export interface HistoryRow extends OperationHistoryItem {
  undoable: boolean
  undone: boolean
}

/** Merge the plain history with undo availability for the UI. */
export async function getHistoryWithUndo(): Promise<HistoryRow[]> {
  const { loadHistory } = await import('./storage')
  const [history, ops] = await Promise.all([
    loadHistory(),
    readJson<OpRecord[]>(historyFile(OPS_FILE), [])
  ])
  const opMap = new Map(ops.map((op) => [op.id, op]))
  return history.map((item) => {
    const op = opMap.get(item.id)
    const undoable = Boolean(op && !op.undone && (op.undo.kind === 'rename' || op.undo.kind === 'move'))
    return { ...item, undoable, undone: Boolean(op?.undone) }
  })
}

