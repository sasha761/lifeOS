import * as React from "react"
import Link from "next/link"
import { cn } from "cn"

type SegmentedSize = "default" | "sm"

type SegmentedTabItem = {
  href: string
  label: React.ReactNode
  active: boolean
  /** Optional real counter shown as `meta` after the label; never a placeholder number. */
  count?: number
}

/** Group frame (mockup `.seg`): page background, 1px border, 3px inner padding. */
function segmentedListClass(size: SegmentedSize = "default") {
  return cn("inline-flex min-w-max items-center rounded-full border bg-background", size === "sm" ? "gap-0.5 p-[3px]" : "gap-1 p-1")
}

/** One pill; the selected one sits on `bg-secondary`. `sm` is the mockup size (12px) for a mouse, 40px for touch. */
function segmentedItemClass(active: boolean, size: SegmentedSize = "default") {
  return cn(
    "inline-flex items-center gap-1.5 rounded-full font-medium transition-colors duration-[180ms]",
    size === "sm" ? "min-h-10 px-3 text-xs pointer-fine:min-h-[26px]" : "min-h-9 px-4 text-sm",
    active ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
  )
}

/**
 * Pill view switcher (Design System v2, spec §16.5, mockup `.seg`): a rounded group with a border,
 * the selected item on `bg-secondary`. Items are links, so every view keeps its own URL and the
 * current one is announced with `aria-current="page"`.
 */
function SegmentedTabs({ items, label, size = "default", className }: { items: SegmentedTabItem[]; label: string; size?: SegmentedSize; className?: string }) {
  return (
    <nav aria-label={label} data-slot="segmented-tabs" className={cn("max-w-full overflow-x-auto", className)}>
      <ul className={segmentedListClass(size)}>
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} aria-current={item.active ? "page" : undefined} className={segmentedItemClass(item.active, size)}>
              {item.label}
              {item.count !== undefined && <span className="text-xs font-medium text-muted-foreground tabular-nums">{item.count}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export { SegmentedTabs, segmentedItemClass, segmentedListClass }
export type { SegmentedSize, SegmentedTabItem }
