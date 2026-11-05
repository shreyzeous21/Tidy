import { useEffect } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { CommandPalette } from '@/components/dialogs/CommandPalette'
import { HomeView } from '@/features/home/HomeView'
import { OverviewView } from '@/features/overview/OverviewView'
import { FilesView } from '@/features/browser/FilesView'
import { DownloadsView } from '@/features/downloads/DownloadsView'
import { AppsView } from '@/features/apps/AppsView'
import { SearchView } from '@/features/search/SearchView'
import { CleanupView } from '@/features/cleanup/CleanupView'
import { TrashView } from '@/features/trash/TrashView'
import { SettingsView } from '@/features/settings/SettingsView'
import { PermissionsDialog } from '@/features/permissions/PermissionsDialog'
import { applyTheme, useAppStore, watchSystemTheme, VIEW_TITLES } from '@/stores/app-store'
import type { ViewId } from '@/stores/app-store'
import { applyAccent } from '@/lib/theme'
import { useBrowserStore, useMetaStore } from '@/stores/browser-store'
import { tidy, unwrap } from '@/lib/api'

/**
 * Global keyboard shortcuts. Deliberately in-app only — Tidy does not
 * register global OS shortcuts. All shortcuts are documented in Settings.
 */
function useGlobalShortcuts(): void {
  const setView = useAppStore((s) => s.setView)
  const focusSearch = useAppStore((s) => s.focusSearch)
  const requestQuickMove = useAppStore((s) => s.requestQuickMove)
  const requestGetInfo = useAppStore((s) => s.requestGetInfo)
  const openPalette = useAppStore((s) => s.openPalette)
  const patchSettings = useAppStore((s) => s.patchSettings)
  const view = useAppStore((s) => s.view)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const meta = event.metaKey
      const key = event.key.toLowerCase()

      if (meta && !event.shiftKey && ['1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(key)) {
        event.preventDefault()
        const views: ViewId[] = [
          'home',
          'overview',
          'files',
          'downloads',
          'apps',
          'search',
          'cleanup',
          'trash',
          'settings'
        ]
        setView(views[Number(key) - 1])
        return
      }
      if (meta && !event.shiftKey && key === 'f') {
        event.preventDefault()
        setView('search')
        focusSearch()
        return
      }
      if (meta && !event.shiftKey && key === 'k') {
        event.preventDefault()
        openPalette()
        return
      }
      if (meta && !event.shiftKey && key === 't') {
        event.preventDefault()
        useBrowserStore.getState().newTab()
        setView('files')
        return
      }
      if (meta && !event.shiftKey && key === 'w') {
        event.preventDefault()
        useBrowserStore.getState().closeTab(useBrowserStore.getState().activeTabId)
        if (view !== 'files') setView('files')
        return
      }
      if (meta && !event.shiftKey && key === 'i') {
        event.preventDefault()
        if (view === 'files') requestGetInfo()
        return
      }
      if (meta && event.shiftKey && key === 'm') {
        event.preventDefault()
        if (view === 'files') requestQuickMove()
        return
      }
      // ⌘⇧. — toggle hidden files, like Finder.
      if (meta && event.shiftKey && key === '.') {
        event.preventDefault()
        const current = useAppStore.getState().settings?.showHiddenFiles ?? false
        void patchSettings({ showHiddenFiles: !current })
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView, focusSearch, requestQuickMove, requestGetInfo, openPalette, patchSettings, view])
}

function useBootstrap(): boolean {
  const loadSettings = useAppStore((s) => s.loadSettings)
  const settings = useAppStore((s) => s.settings)
  const { setHomeFolders, setHomePath, setAppInfo } = useMetaStore()

  useEffect(() => {
    void loadSettings()
    void unwrap(tidy().getAppInfo())
      .then((info) => {
        setAppInfo(info)
        setHomePath(info.homePath)
      })
      .catch(() => {})
    void unwrap(tidy().getHomeFolders())
      .then((result) => setHomeFolders(result.folders))
      .catch(() => {})
  }, [loadSettings, setAppInfo, setHomeFolders, setHomePath])

  // Theme + accent side-effects.
  const theme = settings?.theme ?? 'system'
  const accent = settings?.accent ?? 'blue'
  useEffect(() => {
    applyTheme(theme)
    applyAccent(accent, theme)
  }, [theme, accent])
  useEffect(
    () =>
      watchSystemTheme(() => {
        const preference = useAppStore.getState().settings?.theme ?? 'system'
        applyAccent(useAppStore.getState().settings?.accent ?? 'blue', preference)
        return preference
      }),
    []
  )

  return settings !== null
}

function CurrentView() {
  const view = useAppStore((s) => s.view)
  switch (view) {
    case 'home':
      return <HomeView />
    case 'overview':
      return <OverviewView />
    case 'files':
      return <FilesView />
    case 'downloads':
      return <DownloadsView />
    case 'apps':
      return <AppsView />
    case 'search':
      return <SearchView />
    case 'cleanup':
      return <CleanupView />
    case 'trash':
      return <TrashView />
    case 'settings':
      return <SettingsView />
  }
}

export default function App() {
  const ready = useBootstrap()
  useGlobalShortcuts()
  const view = useAppStore((s) => s.view)
  const theme = useAppStore((s) => s.settings?.theme ?? 'system')
  const onboardingCompleted = useAppStore((s) => s.settings?.onboardingCompleted)
  const openPermissions = useAppStore((s) => s.openPermissions)
  const resolved: 'light' | 'dark' | 'system' = theme

  // First run: walk through macOS access before anything else.
  useEffect(() => {
    if (ready && onboardingCompleted !== true) openPermissions()
  }, [ready, onboardingCompleted, openPermissions])

  if (!ready) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Starting Tidy…</div>
  }

  return (
    <TooltipProvider delayDuration={350}>
      <SidebarProvider className="h-svh">
        <AppSidebar />
        <SidebarInset className="h-full overflow-hidden">
          {/* Toolbar under the native macOS title bar. */}
          <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
            <SidebarTrigger />
            <span className="text-[13px] font-semibold tracking-tight">{VIEW_TITLES[view]}</span>
          </header>
          <div className="min-h-0 flex-1 overflow-hidden">
            <CurrentView />
          </div>
          <StatusFooter />
        </SidebarInset>
      </SidebarProvider>
      <Toaster theme={resolved} position="bottom-right" />
      <CommandPalette />
      <PermissionsDialog />
    </TooltipProvider>
  )
}

function StatusFooter() {
  const appInfo = useMetaStore((s) => s.appInfo)
  return (
    <footer className="flex h-6 shrink-0 items-center justify-between border-t border-border px-3 text-[10.5px] text-muted-foreground">
      <span>Tidy records only actions taken inside the app.</span>
      <span>{appInfo ? `v${appInfo.versions.app} · Electron ${appInfo.versions.electron}` : ''}</span>
    </footer>
  )
}
