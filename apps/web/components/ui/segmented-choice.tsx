"use client"

import * as React from "react"
import { cn } from "cn"
import { segmentedItemClass, segmentedListClass } from "./segmented-tabs.tsx"

type SegmentedChoiceOption = { value: string; label: string }

/**
 * One-of-many form choice in the look of SegmentedTabs (mockup 10: «Сфера», «Как считать прогресс»).
 * Native radio buttons keep form submission, arrow-key navigation and the radio role; each input covers
 * its pill, and the pill shows the keyboard focus ring.
 */
function SegmentedChoice({ name, legend, options, defaultValue, error, onValueChange, className }: {
  name: string
  legend: string
  options: readonly SegmentedChoiceOption[]
  defaultValue?: string
  /** Validation message; marks the radios invalid so the form can focus the first one. */
  error?: string
  onValueChange?: (value: string) => void
  className?: string
}) {
  const [value, setValue] = React.useState(defaultValue ?? "")
  const errorId = error ? `${name}-error` : undefined
  return (
    <fieldset data-slot="segmented-choice" className={cn("min-w-0", className)}>
      <legend className="field-label mb-1.5">{legend}</legend>
      <div className={cn(segmentedListClass("sm"), "max-w-full min-w-0 flex-wrap rounded-[18px]")}>
        {options.map((option) => {
          const checked = value === option.value
          return (
            <label
              key={option.value}
              className={cn(
                segmentedItemClass(checked, "sm"),
                "relative cursor-pointer has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => { setValue(option.value); onValueChange?.(option.value) }}
                aria-invalid={error ? true : undefined}
                aria-describedby={errorId}
                className="absolute inset-0 size-full cursor-pointer appearance-none rounded-full opacity-0"
              />
              {option.label}
            </label>
          )
        })}
      </div>
      {error && <p id={errorId} className="mt-1.5 text-sm leading-5 text-destructive">{error}</p>}
    </fieldset>
  )
}

export { SegmentedChoice }
export type { SegmentedChoiceOption }
