import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { ApiError, tidy, unwrap } from '@/lib/api'

interface RenameDialogProps {
  path: string
  currentName: string
  onClose: (renamed: boolean) => void
}

const INVALID_CHARS = ['/', ':', '\0']

export function RenameDialog({ path, currentName, onClose }: RenameDialogProps) {
  const [name, setName] = useState(currentName)
  const [conflict, setConflict] = useState(false)
  const [overwrite, setOverwrite] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Preselect the basename (without extension), like Finder.
    const dot = currentName.lastIndexOf('.')
    const selectEnd = dot > 0 ? dot : currentName.length
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(0, selectEnd)
    })
  }, [currentName])

  const trimmed = name.trim()
  const changed = trimmed !== currentName
  const invalid =
    trimmed.length === 0 ||
    INVALID_CHARS.some((c) => trimmed.includes(c)) ||
    trimmed === '.' ||
    trimmed === '..'

  const submit = async (): Promise<void> => {
    if (invalid || busy) return
    setBusy(true)
    try {
      await unwrap(tidy().renameItem(path, trimmed, overwrite))
      toast.success(`Renamed to “${trimmed}”`)
      onClose(true)
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'ALREADY_EXISTS' || error.code === 'CONFLICT')) {
        setConflict(true)
      } else {
        toast.error(error instanceof Error ? error.message : 'Rename failed.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename</DialogTitle>
          <DialogDescription>Choose a new name for “{currentName}”.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Input
            ref={inputRef}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setConflict(false)
            }}
            aria-label="New name"
            autoComplete="off"
            spellCheck={false}
          />
          {invalid && trimmed.length > 0 ? (
            <p className="mt-2 text-xs text-destructive">Names can’t contain “/” or “:”.</p>
          ) : null}
          {conflict ? (
            <label className="mt-2 flex items-center gap-2 text-xs">
              <Checkbox checked={overwrite} onCheckedChange={(v) => setOverwrite(v === true)} />
              An item with this name exists — replace it
            </label>
          ) : null}
          <DialogFooter className="mt-4">
            <Button type="button" variant="ghost" onClick={() => onClose(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={invalid || busy || (!changed && !overwrite)}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
