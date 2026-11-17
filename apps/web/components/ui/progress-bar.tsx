import { cn } from "cn"
import type { Tone } from "../../lib/tones.ts"

// Static class names so Tailwind generates them; the fill colour is the sphere or status tone.
const fills: Record<Tone, string> = {
  primary: "[&::-moz-progress-bar]:bg-primary [&::-webkit-progress-value]:bg-primary",
  green: "[&::-moz-progress-bar]:bg-st-green [&::-webkit-progress-value]:bg-st-green",
  blue: "[&::-moz-progress-bar]:bg-st-blue [&::-webkit-progress-value]:bg-st-blue",
  amber: "[&::-moz-progress-bar]:bg-st-amber [&::-webkit-progress-value]:bg-st-amber",
  orange: "[&::-moz-progress-bar]:bg-st-orange [&::-webkit-progress-value]:bg-st-orange",
  red: "[&::-moz-progress-bar]:bg-st-red [&::-webkit-progress-value]:bg-st-red",
  cyan: "[&::-moz-progress-bar]:bg-st-cyan [&::-webkit-progress-value]:bg-st-cyan",
  gray: "[&::-moz-progress-bar]:bg-st-gray [&::-webkit-progress-value]:bg-st-gray",
}

/**
 * Progress of one goal (mockup `.bar`: 6px track on surface-3, rounded fill). A native `<progress>` keeps the
 * `progressbar` role and value for assistive technology. Render it only for a real percentage: without data
 * the caller shows text instead of an empty bar.
 */
function ProgressBar({ value, label, tone = "primary", size = "sm", className }: {
  /** Percentage 0–100; values outside are clamped. */
  value: number
  /** Accessible name, e.g. «Прогресс: <цель>». */
  label: string
  tone?: Tone
  /** `sm` — 6px list bar, `md` — 8px on the goal page. */
  size?: "sm" | "md"
  className?: string
}) {
  return (
    <progress
      data-slot="progress-bar"
      max={100}
      value={Math.min(100, Math.max(0, value))}
      aria-label={label}
      className={cn(
        "block w-full min-w-0 appearance-none overflow-hidden rounded-full border-0 bg-surface-3 [&::-moz-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-surface-3 [&::-webkit-progress-value]:rounded-full",
        size === "md" ? "h-2" : "h-1.5",
        fills[tone],
        className
      )}
    />
  )
}

export { ProgressBar }
