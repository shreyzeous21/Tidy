import { ipcMain } from 'electron'
import { AppError, guard } from '../utils/errors'
import {
  checkPermission,
  getPermissionStatuses,
  openPermissionSettings,
  requestPermission
} from '../services/permissions'
import type { PermissionId } from '@shared/types/permissions'

/** macOS permission onboarding IPC. */

const VALID_IDS = new Set<PermissionId>(['folders', 'fullDiskAccess'])

function asPermissionId(input: unknown): PermissionId {
  if (typeof input === 'string' && VALID_IDS.has(input as PermissionId)) {
    return input as PermissionId
  }
  throw new AppError('INVALID_INPUT', 'Unknown permission requested.')
}

export function registerPermissionHandlers(): void {
  ipcMain.handle('permissions:status', () => guard(() => getPermissionStatuses()))

  ipcMain.handle('permissions:check', (_event, id: unknown) =>
    guard(() => checkPermission(asPermissionId(id)))
  )

  ipcMain.handle('permissions:request', (_event, id: unknown) =>
    guard(() => requestPermission(asPermissionId(id)))
  )

  ipcMain.handle('permissions:open-settings', (_event, id: unknown) =>
    guard(async () => {
      await openPermissionSettings(asPermissionId(id))
    })
  )
}
