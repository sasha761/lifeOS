import { cn } from "cn"
import type { DomainKey } from "@lifeos/contracts"
import { domainPresentation } from "../../lib/domain-presentation.ts"
import type { Tone } from "../../lib/tones.ts"

// Sphere colour on a 20% tint of itself (mockup `.dom`); the icon is non-text content (≥ 3:1).
const tints: Record<Tone, string> = {
  primary: "bg-primary/20 text-primary",
  green: "bg-st-green/20 text-st-green",
  blue: "bg-st-blue/20 text-st-blue",
  amber: "bg-st-amber/20 text-st-amber",
  orange: "bg-st-orange/20 text-st-orange",
  red: "bg-st-red/20 text-st-red",
  cyan: "bg-st-cyan/20 text-st-cyan",
  gray: "bg-st-gray/20 text-muted-foreground",
}

const sizes = {
  /** 22px — menus and compact rows. */
  sm: "size-[22px] rounded-[7px] [&>svg]:size-3.5",
  /** 30px — goal rows and cards. */
  md: "size-[30px] rounded-[9px] [&>svg]:size-4",
  /** 44px — sphere page header. */
  lg: "size-11 rounded-xl [&>svg]:size-[22px]",
}

/** Square sphere icon. Decorative: the sphere name is always written next to it. */
function DomainIcon({ domain, size = "md", className }: { domain: DomainKey; size?: keyof typeof sizes; className?: string }) {
  const { icon: Icon, tone } = domainPresentation[domain]
  return (
    <span aria-hidden="true" data-slot="domain-icon" data-domain={domain} className={cn("inline-flex shrink-0 items-center justify-center", tints[tone], sizes[size], className)}>
      <Icon strokeWidth={1.8} />
    </span>
  )
}

export { DomainIcon }
