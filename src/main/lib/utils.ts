import path from 'node:path'
import { existsSync } from 'node:fs'
import { app } from 'electron'

/**
 * Pick an app icon for the dock (dev mode). Packaging uses the icons in
 * build/ via electron-builder; drop a 512×512 (or 1024×1024) PNG at
 * build/icon.png to see it in the dock during development.
 */
export function pickIcon(): string | null {
  const candidates = [
    path.join(app.getAppPath(), 'build', 'icon.png'),
    path.join(app.getAppPath(), 'build', 'icon.icns'),
    path.join(app.getAppPath(), 'resources', 'icon.png')
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}
