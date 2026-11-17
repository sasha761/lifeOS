import type * as React from "react"
import { cn } from "cn"

/**
 * Page title block (mockups 09-goals, 10-domain-new-goal, 16-settings): `.page-title` (30/36 from 768px,
 * 26/32 on mobile) with a 14px subtitle on the left and actions on the right; on narrow screens the actions
 * wrap under the title. A `<strong>` in the description is the bold lead from the mockups.
 */
function PageHeader({ title, description, actions, icon, titleId, className }: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  /** Optional leading visual, e.g. a large DomainIcon on a sphere page. */
  icon?: React.ReactNode
  titleId?: string
  className?: string
}) {
  return (
    <div data-slot="page-header" className={cn("flex flex-wrap items-center justify-between gap-x-6 gap-y-4", className)}>
      <div className="flex min-w-0 flex-1 basis-80 items-center gap-3.5">
        {icon}
        <div className="min-w-0">
          <h1 id={titleId} className="page-title wrap-anywhere">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground wrap-anywhere [&_strong]:font-semibold [&_strong]:text-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  )
}

export { PageHeader }
