"use client"

import { useEffect, useRef } from "react"
import type * as React from "react"
import { cn } from "cn"

const FOCUSABLE = "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])"

/** Keeps Tab inside an open dialog or card: from the last visible control to the first and back. */
function trapTab(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((control) => control.getClientRects().length > 0)
  const first = controls[0]
  const last = controls.at(-1)
  if (!first || !last) { event.preventDefault(); return }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

/**
 * Native modal `<dialog>` (showModal): the page behind is inert, focus moves inside (`[data-dialog-initial-focus]` when
 * present, otherwise the browser's first control) and returns to the previous element on close. Escape calls `onClose`
 * unless the dialog is `busy`. Size, position and padding come from `className`.
 */
function ModalDialog({ labelledBy, describedBy, role = "dialog", busy = false, onClose, className, children, ...rest }: {
  labelledBy: string; describedBy?: string; role?: "dialog" | "alertdialog"; busy?: boolean; onClose(): void; className?: string; children: React.ReactNode;
} & Pick<React.ComponentProps<"dialog">, "id"> & { "data-testid"?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    const element = dialog.current
    element?.showModal()
    // React's autoFocus runs while the native dialog is still closed. Focus explicitly after showModal.
    element?.querySelector<HTMLElement>("[data-dialog-initial-focus]")?.focus()
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return <dialog ref={dialog} role={role} aria-modal="true" aria-labelledby={labelledBy} aria-describedby={describedBy} {...rest}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }} onKeyDown={trapTab}
    className={cn("overflow-y-auto border bg-card text-foreground shadow-dialog backdrop:bg-background/75", className)}>{children}</dialog>
}

export { ModalDialog, trapTab }
