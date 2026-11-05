import path from 'node:path'
import { app, BrowserWindow, Menu } from 'electron'

import { FileWatcher, VolumeWatcher } from './services/file-watcher'
import { CancelRegistry } from './services/cleanup'
import { createHandlerContext } from './ipc/context'
import { registerFileHandlers } from './ipc/file-handlers'
import { registerSearchHandlers } from './ipc/search-handlers'
import { registerSettingsHandlers } from './ipc/settings-handlers'
import { registerCleanupHandlers } from './ipc/cleanup-handlers'
import { registerPermissionHandlers } from './ipc/permission-handlers'
import { registerSystemHandlers } from './ipc/system-handlers'
import { pickIcon } from './lib/utils'

/**
 * Tidy — main process entry.
 *
 * Security posture:
 * - contextIsolation on, nodeIntegration off, sandbox on, no webview tag.
 * - All filesystem work happens here; the renderer only sees the typed
 *   contextBridge API (see src/preload).
 * - Navigation away from the app is blocked; window.open is denied.
 */

const directory = __dirname
const INDEX_HTML = path.join(directory, '../renderer/index.html')
// Set by `electron-vite dev` (the counterpart of VITE_DEV_SERVER_URL in plain Vite apps).
const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL

const iconPath = pickIcon()

// Keep a reference so the watcher is not garbage-collected mid-session.
let watcher: FileWatcher | null = null
let volumeWatcher: VolumeWatcher | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1140,
    height: 740,
    minWidth: 900,
    minHeight: 580,
    show: false,
    // Native macOS title bar: traffic lights + "Tidy" title, content below —
    // the standard look other Mac apps use.
    title: 'Tidy',
    backgroundColor: '#f5f5f4',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      preload: path.join(directory, '../preload/index.js')
    }
  })

  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`did-fail-load ${code} ${description} → ${url}`)
  })

  // The renderer is a local app shell — no external navigation, no popups.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!DEV_SERVER_URL || !url.startsWith(DEV_SERVER_URL)) event.preventDefault()
  })

  window.once('ready-to-show', () => window.show())

  if (DEV_SERVER_URL) {
    console.log('Loading dev server:', DEV_SERVER_URL)
    void window.loadURL(DEV_SERVER_URL).catch((error) => console.error('loadURL:', error))
    window.webContents.openDevTools({ mode: 'detach' })
  } else {
    console.log('Loading file:', INDEX_HTML)
    void window.loadFile(INDEX_HTML).catch((error) => console.error('loadFile:', error))
  }

  return window
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    if (process.platform === 'darwin' && iconPath) {
      app.dock?.setIcon(iconPath)
    }

    // Privileged services + typed IPC surface (registered once, up front).
    registerSystemHandlers()
    watcher = new FileWatcher(() => BrowserWindow.getAllWindows()[0] ?? null)
    const cancels = new CancelRegistry()
    void createHandlerContext(watcher, cancels).then((ctx) => {
      registerFileHandlers(ctx)
      registerSearchHandlers()
      registerSettingsHandlers(ctx)
      registerCleanupHandlers(ctx)
      registerPermissionHandlers()
    })

    buildMenu()
    createWindow()

    // React to external drives being mounted/unmounted.
    volumeWatcher = new VolumeWatcher(() => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('volumes:changed')
    })
    volumeWatcher.start()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    watcher?.dispose()
    volumeWatcher?.dispose()
    watcher = null
    volumeWatcher = null
  })

  // Nothing in Tidy opens external links; if one ever appears, route it to
  // the system browser rather than loading it in-app.
  app.on('open-url', (event) => event.preventDefault())

  // Prevent hidden <webview> attachments — not part of the app.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        ...(DEV_SERVER_URL
          ? [{ role: 'reload' as const }, { role: 'toggleDevTools' as const }, { type: 'separator' as const }]
          : []),
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
