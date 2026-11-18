import { cn } from "cn"
import type { Tone } from "../../lib/tones.ts"

// Static class names so Tailwind generates them; colour values live only in globals.css.
const fills: Record<Tone, string> = {
  primary: "bg-primary",
  green: "bg-st-green",
  blue: "bg-st-blue",
  amber: "bg-st-amber",
  orange: "bg-st-orange",
  red: "bg-st-red",
  cyan: "bg-st-cyan",
  gray: "bg-st-gray",
}

/** 8px colour marker of a sphere or status (mockup 04, «Сферы жизни»). Decorative: the text next to it names the sphere. */
function ToneDot({ tone = "primary", className }: { tone?: Tone; className?: string }) {
  return <span aria-hidden="true" data-slot="tone-dot" className={cn("inline-block size-2 shrink-0 rounded-full", fills[tone], className)} />
}

export { ToneDot }
