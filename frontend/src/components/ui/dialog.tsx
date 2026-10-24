import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: DialogProps) {
  const dialogRef = React.useRef<HTMLDialogElement>(null)
  const dialogId = React.useId()

  React.useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={dialogId + '-title'}
      aria-describedby={description ? dialogId + '-description' : undefined}
      onCancel={(event) => {
        event.preventDefault()
        onOpenChange(false)
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onOpenChange(false)
      }}
      className={cn(
        'm-auto max-h-[min(88dvh,900px)] w-[min(92vw,640px)] overflow-y-auto rounded-2xl border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-black/40',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b p-5 sm:p-6">
        <div className="grid gap-1.5">
          <h2 id={dialogId + '-title'} className="text-lg font-bold tracking-tight">{title}</h2>
          {description && <p id={dialogId + '-description'} className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <button
          type="button"
          aria-label="Close dialog"
          onClick={() => onOpenChange(false)}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X aria-hidden="true" size={17} />
        </button>
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </dialog>
  )
}
