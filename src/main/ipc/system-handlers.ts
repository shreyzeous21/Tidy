import { ipcMain } from 'electron'
import { guard } from '../utils/errors'
import { getSystemInfo } from '../services/system-info'

/** Hardware summary for the sidebar equipment card. */
export function registerSystemHandlers(): void {
  ipcMain.handle('app:system-info', () => guard(() => getSystemInfo()))
}