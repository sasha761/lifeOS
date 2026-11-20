import type * as React from "react"
import { cn } from "cn"
import type { Tone } from "../../lib/tones.ts"

type ChipTone = Tone | "neutral" | "outline"

/*
 * Chip text must reach 4.5:1 (11px). Tone-coloured text on a 15% tint of the card passes for green, amber,
 * orange and cyan (5.3–6.4:1) but not for primary, blue and red (≈4.1:1), so those keep light text —
 * accessibility wins over the mockup (docs/UI_GUIDELINES.md §4). New lighter shades would need an ADR.
 */
const tones: Record<ChipTone, string> = {
  primary: "bg-primary/15 text-foreground",
  green: "bg-st-green/15 text-st-green",
  blue: "bg-st-blue/15 text-foreground",
  amber: "bg-st-amber/15 text-st-amber",
  orange: "bg-st-orange/15 text-st-orange",
  red: "bg-st-red/15 text-foreground",
  cyan: "bg-st-cyan/15 text-st-cyan",
  gray: "bg-st-gray/20 text-muted-foreground",
  /** Mockup `.chip` without a colour: surface-3. */
  neutral: "bg-surface-3 text-muted-foreground",
  /** Mockup `.c-x`: transparent with a strong border (e.g. a deadline). */
  outline: "border border-border-strong text-muted-foreground",
}

/** Small pill for a status, a sphere or a deadline (mockup `.chip`, 11px · 600). */
function StatusChip({ tone = "neutral", children, className }: { tone?: ChipTone; children: React.ReactNode; className?: string }) {
  return (
    <span data-slot="status-chip" data-tone={tone} className={cn("inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-4 font-semibold whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  )
}

export { StatusChip }
export type { ChipTone }
