"use client";

import { useEffect } from "react";
import type { RefObject } from "react";

/** Closes a disclosure on Escape (returning focus to its toggle) and on a pointer press outside it. */
export function useDismiss(open: boolean, close: () => void, container: RefObject<HTMLElement | null>, toggle: RefObject<HTMLButtonElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { close(); toggle.current?.focus(); } };
    const onPointer = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) close(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onPointer); };
  }, [open, close, container, toggle]);
}
