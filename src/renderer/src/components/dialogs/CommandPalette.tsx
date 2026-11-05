import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search,
  House,
  FolderOpen,
  Download,
  LayoutGrid,
  Eraser,
  Trash2,
  Settings2,
  LayoutDashboard,
  HardDrive,
  Eye,
  EyeOff,
  Sun,
  Moon,
  Plus,
  X,
  Bookmark
} from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useAppStore, applyTheme } from '@/stores/app-store'
import type { ViewId } from '@/stores/app-store'
import { useBrowserStore, useMetaStore } from '@/stores/browser-store'
import { shortenHome } from '@/lib/format'
import type { ThemePreference } from '@shared/types/settings'
import { cn } from 'cn'

interface PaletteItem {
  id: string
  label: string
  hint?: string
  icon: React.ReactNode
  run: () => void
}

/**
 * Command palette (⌘K): jump to sections and folders, toggle settings,
 * manage tabs, apply saved searches. Nothing here acts without being
 * explicitly chosen.
 */
export function CommandPalette() {
  const paletteSignal = useAppStore((s) => s.paletteSignal)
  const view = useAppStore((s) => s.view)
  const settings = useAppStore((s) => s.settings)
  const patchSettings = useAppStore((s) => s.patchSettings)
  const theme = settings?.theme ?? 'system'
  const { homeFolders, homePath, volumes } = useMetaStore()

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (paletteSignal > 0) {
      // Opening the palette resets its input — one-shot signal pattern.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true)
      setQuery('')
      setCursor(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [paletteSignal])

  const go = (target: ViewId): void => useAppStore.getState().setView(target)

  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = []

    const views: Array<[ViewId, string, React.ReactNode]> = [
      ['home', 'Home', <House className="size-4" />],
      ['overview', 'Overview', <LayoutDashboard className="size-4" />],
      ['files', 'Files', <FolderOpen className="size-4" />],
      ['downloads', 'Downloads', <Download className="size-4" />],
      ['apps', 'Apps', <LayoutGrid className="size-4" />],
      ['search', 'Search', <Search className="size-4" />],
      ['cleanup', 'Clean Up', <Eraser className="size-4" />],
      ['trash', 'Trash', <Trash2 className="size-4" />],
      ['settings', 'Settings', <Settings2 className="size-4" />]
    ]
    for (const [id, label, icon] of views) {
      list.push({
        id: `view-${id}`,
        label: `Go to ${label}`,
        hint: id === view ? 'current' : undefined,
        icon,
        run: () => go(id)
      })
    }

    // Folders: home quick access, root, pinned, recents, volumes.
    for (const folder of homeFolders) {
      list.push({
        id: `folder-${folder.path}`,
        label: folder.name,
        hint: 'folder',
        icon: <FolderOpen className="size-4 text-sky-500 dark:text-sky-400" />,
        run: () => {
          useBrowserStore.getState().navigate(folder.path)
          go('files')
        }
      })
    }
    list.push({
      id: 'folder-root',
      label: 'Macintosh HD (entire disk)',
      hint: 'folder',
      icon: <HardDrive className="size-4 text-muted-foreground" />,
      run: () => {
        useBrowserStore.getState().navigate('/')
        go('files')
      }
    })
    for (const pinned of settings?.pinnedFolders ?? []) {
      list.push({
        id: `pinned-${pinned}`,
        label: shortenHome(pinned, homePath),
        hint: 'pinned',
        icon: <FolderOpen className="size-4 text-muted-foreground" />,
        run: () => {
          useBrowserStore.getState().navigate(pinned)
          go('files')
        }
      })
    }
    for (const recent of settings?.recentDestinations ?? []) {
      list.push({
        id: `recent-${recent}`,
        label: shortenHome(recent, homePath),
        hint: 'recent',
        icon: <FolderOpen className="size-4 text-muted-foreground/70" />,
        run: () => {
          useBrowserStore.getState().navigate(recent)
          go('files')
        }
      })
    }
    for (const volume of volumes) {
      list.push({
        id: `volume-${volume.path}`,
        label: volume.name,
        hint: 'drive',
        icon: <HardDrive className="size-4 text-muted-foreground" />,
        run: () => {
          useBrowserStore.getState().navigate(volume.path)
          go('files')
        }
      })
    }

    // Actions.
    const showHidden = settings?.showHiddenFiles ?? false
    list.push({
      id: 'toggle-hidden',
      label: showHiddenFilesLabel(showHidden),
      icon: showHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />,
      run: () => void patchSettings({ showHiddenFiles: !showHidden })
    })
    list.push({
      id: 'cycle-theme',
      label: `Appearance: ${theme} — change`,
      icon: theme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />,
      run: () => {
        const order: ThemePreference[] = ['system', 'light', 'dark']
        const next = order[(order.indexOf(theme) + 1) % order.length]
        void patchSettings({ theme: next })
        applyTheme(next)
      }
    })
    list.push({
      id: 'new-tab',
      label: 'New tab',
      hint: '⌘T',
      icon: <Plus className="size-4" />,
      run: () => {
        useBrowserStore.getState().newTab()
        go('files')
      }
    })
    list.push({
      id: 'close-tab',
      label: 'Close current tab',
      hint: '⌘W',
      icon: <X className="size-4" />,
      run: () => useBrowserStore.getState().closeTab(useBrowserStore.getState().activeTabId)
    })
    // Saved searches.
    for (const saved of settings?.savedSearches ?? []) {
      list.push({
        id: `saved-${saved.id}`,
        label: `Search: ${saved.name}`,
        hint: saved.query || undefined,
        icon: <Bookmark className="size-4 text-muted-foreground" />,
        run: () => useAppStore.getState().applySavedSearch(saved)
      })
    }

    return list
  }, [homeFolders, homePath, volumes, settings, theme, view, patchSettings])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => `${item.label} ${item.hint ?? ''}`.toLowerCase().includes(q))
  }, [items, query])

  const runAt = (index: number): void => {
    const item = filtered[index]
    if (!item) return
    setOpen(false)
    item.run()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0" showCloseButton={false}>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setCursor(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setCursor((c) => Math.min(c + 1, filtered.length - 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setCursor((c) => Math.max(c - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                runAt(cursor)
              }
            }}
            placeholder="Type a command or folder…"
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Command palette"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <ul className="max-h-80 overflow-y-auto p-1.5" role="listbox">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-muted-foreground">No matches</li>
          ) : (
            filtered.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === cursor}
                  onClick={() => runAt(index)}
                  onMouseEnter={() => setCursor(index)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] outline-none',
                    index === cursor ? 'bg-primary/10 text-primary' : 'hover:bg-foreground/5'
                  )}
                >
                  {item.icon}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint ? (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70">{item.hint}</span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
          ↑↓ navigate · ↵ run · esc close
        </div>
      </DialogContent>
    </Dialog>
  )
}

function showHiddenFilesLabel(current: boolean): string {
  return current ? 'Hide hidden files' : 'Show hidden files'
}
