import * as React from "react"
import Link from "next/link"
import { cn } from "cn"

type SegmentedTabItem = {
  href: string
  label: React.ReactNode
  active: boolean
  /** Optional real counter shown as `meta` after the label; never a placeholder number. */
  count?: number
}

/**
 * Pill view switcher (Design System v2, spec §16.5): a rounded `bg-card` group with a border,
 * the selected item on `bg-secondary`. Items are links, so every view keeps its own URL and the
 * current one is announced with `aria-current="page"`.
 */
function SegmentedTabs({ items, label, className }: { items: SegmentedTabItem[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} data-slot="segmented-tabs" className={cn("max-w-full overflow-x-auto", className)}>
      <ul className="inline-flex min-w-max items-center gap-1 rounded-full border bg-card p-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors duration-[180ms]",
                item.active ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              )}
            >
              {item.label}
              {item.count !== undefined && <span className="text-xs font-medium text-muted-foreground tabular-nums">{item.count}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export { SegmentedTabs }
export type { SegmentedTabItem }
