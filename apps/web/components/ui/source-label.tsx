import type * as React from "react"
import { cn } from "cn"

/**
 * Where a number comes from (README макетов: «ручной ввод», «измерено системой», «самоотчёт»…), shown as
 * «◉ ручной ввод · 12.11». The marker is decorative; the words carry the meaning.
 */
function SourceLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span data-slot="source-label" className={cn("inline-flex min-w-0 items-baseline gap-1 text-[11px] leading-4 text-muted-foreground", className)}>
      <span aria-hidden="true" className="text-text-3">◉</span>
      <span className="min-w-0 wrap-anywhere">{children}</span>
    </span>
  )
}

export { SourceLabel }
