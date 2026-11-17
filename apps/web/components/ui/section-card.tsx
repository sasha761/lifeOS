import type * as React from "react"
import { cn } from "cn"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "./card.tsx"

type SectionCardProps = Omit<React.ComponentProps<typeof Card>, "title"> & {
  title: React.ReactNode
  /** Id of the heading; the card is labelled by it. */
  titleId: string
  headingLevel?: 2 | 3
  /** Optional icon before the title. */
  icon?: React.ReactNode
  /** Short caption under the title, e.g. the source of the numbers. */
  description?: React.ReactNode
  /** Action on the right of the title (button, link, chip). */
  action?: React.ReactNode
  /** `dashed` is the placeholder card for something that is not available yet. */
  variant?: "default" | "dashed"
  contentClassName?: string
  /** The heading can receive focus from script (e.g. after saving), without entering the Tab order. */
  focusableTitle?: boolean
}

/**
 * Titled card from the mockups (`.card`: surface-1, 1px border, radius 16, padding 18–20): the shared `Card`
 * with a real heading, an optional caption and an action on the right. It is a named region by default
 * (pass role="article" for repeated cards such as spheres).
 */
function SectionCard({ title, titleId, headingLevel = 2, icon, description, action, variant = "default", className, contentClassName, focusableTitle = false, role = "region", children, ...props }: SectionCardProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3"
  return (
    <Card
      role={role}
      aria-labelledby={titleId}
      data-variant={variant}
      className={cn(
        "min-w-0 gap-3.5 rounded-2xl text-[13px] leading-5 [--card-spacing:--spacing(5)]",
        variant === "dashed" && "bg-transparent ring-0 outline-[1.5px] -outline-offset-[1.5px] outline-dashed outline-border-strong",
        className
      )}
      {...props}
    >
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2 text-base leading-[22px] font-bold">
          {icon}
          <Heading id={titleId} tabIndex={focusableTitle ? -1 : undefined} className="min-w-0 rounded wrap-anywhere">{title}</Heading>
        </CardTitle>
        {description && <CardDescription className="text-xs leading-4">{description}</CardDescription>}
        {action && <CardAction className="flex flex-wrap items-center gap-2">{action}</CardAction>}
      </CardHeader>
      <CardContent className={cn("min-w-0", contentClassName)}>{children}</CardContent>
    </Card>
  )
}

export { SectionCard }
