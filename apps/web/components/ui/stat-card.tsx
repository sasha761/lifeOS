import type * as React from "react"
import { cn } from "cn"
import { Card } from "./card.tsx"

/**
 * One number with its caption (mockups 09-goals «Старт / Сейчас / Цель», 04-progress «Рекорды»):
 * label, value, an optional hint and an optional source. Only real values are passed in; a missing value
 * is shown as the caller's explicit placeholder, never as zero.
 */
function StatCard({ label, value, hint, source, size = "sm", className }: {
  label: React.ReactNode
  value: React.ReactNode
  hint?: React.ReactNode
  /** Usually a SourceLabel. */
  source?: React.ReactNode
  /** `sm` — tile inside a card (13px value); `lg` — metric 28px. */
  size?: "sm" | "lg"
  className?: string
}) {
  return (
    <Card size="sm" data-slot="stat-card" className={cn("min-w-0 gap-1 rounded-xl bg-surface-2 px-3.5 [--card-spacing:--spacing(3)]", className)}>
      <dl className="grid min-w-0 gap-1">
        <dt className="text-[11px] leading-4 text-muted-foreground">{label}</dt>
        <dd className={cn("min-w-0 wrap-anywhere tabular-nums", size === "lg" ? "text-[28px] leading-8 font-extrabold" : "text-[13px] leading-5 font-semibold")}>{value}</dd>
        {hint && <dd className="text-[11px] leading-4 text-muted-foreground wrap-anywhere">{hint}</dd>}
        {source && <dd>{source}</dd>}
      </dl>
    </Card>
  )
}

export { StatCard }
