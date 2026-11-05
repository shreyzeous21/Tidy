import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, shell } from 'electron'
import {
  PERMISSION_IDS,
  SYSTEM_SETTINGS_ONLY
} from '@shared/types/permissions'
import type { PermissionId, PermissionState, PermissionStatus } from '@shared/types/permissions'

/**
 * macOS permission probing for the first-run onboarding.
 *
 * Tidy never asks for anything it doesn't use. Each permission is *checked*
 * by actually touching the protected location and reading the errno — there is
 * no reliable public TCC query API, so the honest signal is whether the read
 * succeeds.
 *
 * - Folder access: macOS shows its own one-by-one prompts the first time the
 *   app reads each protected folder, so `requestPermission` simply performs
 *   those reads to raise the prompts.
 * - Full Disk Access: no in-app prompt exists; the only path is System
 *   Settings, which `openPermissionSettings` deep-links to.
 */

const FOLDER_IDS = ['desktop', 'documents', 'downloads'] as const

const SETTINGS_URLS: Record<PermissionId, string> = {
  folders: 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders',
  fullDiskAccess: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
}

function folderPaths(): string[] {
  const paths: string[] = []
  for (const id of FOLDER_IDS) {
    try {
      paths.push(app.getPath(id))
    } catch {
      // A machine without, say, a localized Desktop path simply skips it.
    }
  }
  return paths
}

/** Read a directory purely to observe whether macOS permits it. */
async function probe(dir: string): Promise<PermissionState> {
  try {
    await fsp.readdir(dir)
    return 'granted'
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES') return 'denied'
    // ENOENT and other non-permission errors are not a denial.
    return 'granted'
  }
}

export async function checkPermission(id: PermissionId): Promise<PermissionStatus> {
  let state: PermissionState
  if (id === 'folders') {
    const probes = await Promise.all(folderPaths().map(probe))
    state = probes.length > 0 && probes.every((result) => result === 'granted') ? 'granted' : 'denied'
  } else {
    // The Trash is the canonical Full Disk Access probe.
    state = await probe(path.join(os.homedir(), '.Trash'))
  }
  return { id, state, systemSettingsOnly: SYSTEM_SETTINGS_ONLY[id] }
}

export async function getPermissionStatuses(): Promise<PermissionStatus[]> {
  return Promise.all(PERMISSION_IDS.map(checkPermission))
}

/**
 * Raise the OS access prompt for a permission where possible, then report the
 * resulting state. For `folders`, reading each protected folder in turn makes
 * macOS present its prompts. For Full Disk Access nothing is triggered in-app.
 */
export async function requestPermission(id: PermissionId): Promise<PermissionStatus> {
  if (id === 'folders') {
    for (const dir of folderPaths()) {
      // Sequential so macOS can queue its prompts one at a time.
      await fsp.readdir(dir).catch(() => {})
    }
  }
  return checkPermission(id)
}

/** Open the exact System Settings pane for a permission. */
export async function openPermissionSettings(id: PermissionId): Promise<void> {
  await shell.openExternal(SETTINGS_URLS[id])
}
