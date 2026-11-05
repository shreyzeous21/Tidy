import {
  House,
  FolderOpen,
  Download,
  LayoutGrid,
  Search,
  Eraser,
  Trash2,
  Settings2,
  Moon,
  Sun,
  LayoutDashboard
} from 'lucide-react'
import logoUrl from '@/assets/logo.png'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail
} from '@/components/ui/sidebar'
import { useAppStore, applyTheme } from '@/stores/app-store'
import type { ViewId } from '@/stores/app-store'
import { applyAccent } from '@/lib/theme'
import { useMetaStore } from '@/stores/browser-store'
import { shortenHome } from '@/lib/format'
import { HardwareCard } from '@/components/common/HardwareCard'
import type { ThemePreference } from '@shared/types/settings'
import type { LucideIcon } from 'lucide-react'

/**
 * Tidy's sidebar — based on the shadcn `sidebar-04` block: floating,
 * collapsible to an icon rail, with tooltips when collapsed.
 */

const NAV_ITEMS: Array<{ id: ViewId; label: string; icon: LucideIcon; shortcut?: string }> = [
  { id: 'home', label: 'Home', icon: House, shortcut: '⌘1' },
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, shortcut: '⌘2' },
  { id: 'files', label: 'Files', icon: FolderOpen, shortcut: '⌘3' },
  { id: 'downloads', label: 'Downloads', icon: Download, shortcut: '⌘4' },
  { id: 'apps', label: 'Apps', icon: LayoutGrid, shortcut: '⌘5' },
  { id: 'search', label: 'Search', icon: Search, shortcut: '⌘6' },
  { id: 'cleanup', label: 'Clean Up', icon: Eraser, shortcut: '⌘7' },
  { id: 'trash', label: 'Trash', icon: Trash2, shortcut: '⌘8' },
  { id: 'settings', label: 'Settings', icon: Settings2, shortcut: '⌘9' }
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const theme = useAppStore((s) => s.settings?.theme ?? 'system')
  const patchSettings = useAppStore((s) => s.patchSettings)
  const watchedDir = useAppStore((s) => s.watchedDir)
  const homePath = useMetaStore((s) => s.homePath)
  const appInfo = useMetaStore((s) => s.appInfo)

  const cycleTheme = (): void => {
    const order: ThemePreference[] = ['system', 'light', 'dark']
    const next = order[(order.indexOf(theme) + 1) % order.length]
    void patchSettings({ theme: next })
    applyTheme(next)
    applyAccent(useAppStore.getState().settings?.accent ?? 'blue', next)
  }

  const ThemeIcon = theme === 'dark' ? Moon : Sun

  return (
    <Sidebar collapsible="icon" {...props}>
      {/* Below the native title bar — no traffic-light clearance needed. */}
      <SidebarHeader className="border-b border-sidebar-border/60 pb-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              size="lg"
              tooltip="Tidy — Clean. Organize. Optimize."
              className="h-auto gap-2.5 p-2"
            >
              <button type="button" onClick={() => setView('home')} aria-label="Tidy home">
                <img
                  src={logoUrl}
                  alt=""
                  draggable={false}
                  className="aspect-square size-10 shrink-0 rounded-[10px] shadow-sm ring-1 ring-black/5 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:rounded-lg dark:ring-white/10"
                />
                <span className="flex min-w-0 flex-col gap-1 leading-none group-data-[collapsible=icon]:hidden">
                  <span className="truncate text-[15px] font-semibold">Tidy</span>
                  <span className="truncate text-[11px] font-normal text-sidebar-foreground/60">
                    Clean. Organize. Optimize.
                  </span>
                </span>
              </button>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {NAV_ITEMS.map(({ id, label, icon: Icon, shortcut }) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton
                    asChild
                    isActive={view === id}
                    tooltip={shortcut ? `${label} (${shortcut})` : label}
                  >
                    <button type="button" onClick={() => setView(id)}>
                      <Icon />
                      <span className="flex flex-1 items-center justify-between">
                        {label}
                        {shortcut ? (
                          <span className="pr-1 text-[11px] font-normal text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
                            {shortcut}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <div className="px-2 pb-1.5 pt-1">
        <HardwareCard />
      </div>

      <SidebarFooter className="border-t border-sidebar-border/60">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={cycleTheme}
              tooltip={`Appearance: ${theme}`}
              aria-label={`Appearance: ${theme}. Click to change.`}
            >
              <ThemeIcon />
              <span className="capitalize">{theme}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="px-2 pb-1.5 flex gap-1 text-[11px] leading-tight text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">
          <span className="block truncate" title={watchedDir ?? undefined}>
            {watchedDir ? `Live: ${shortenHome(watchedDir, homePath)}` : 'Idle'}
          </span>
          <span className="block truncate">v{appInfo?.versions.app ?? '...'}</span>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
