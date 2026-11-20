"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "cn";
import { LANGUAGE_LEVELS } from "@lifeos/contracts";
import type { DomainKey } from "@lifeos/contracts";
import { domainPresentation } from "../../lib/domain-presentation.ts";
import { endOfLocalDay } from "../../lib/goal-time.ts";
import { deadlineDate } from "../../lib/onboarding-presentation.ts";
import type { Tone } from "../../lib/tones.ts";
import { DomainIcon } from "../ui/domain-icon.tsx";

/*
 * Building blocks of the onboarding wizard (mockups 24–29, LFS-219). Native radios and checkboxes keep keyboard use and
 * roles; the visible circle or square follows the mockup (`.radio`, `.box`), the card shows the focus ring.
 */

const eyebrowTones: Record<Tone, string> = {
  primary: "text-primary", green: "text-st-green", blue: "text-st-blue", amber: "text-st-amber",
  orange: "text-st-orange", red: "text-st-red", cyan: "text-st-cyan", gray: "text-muted-foreground",
};

/** «Ф ФИНАНСЫ» above a question: the sphere icon and its name in the sphere colour (`.cap`). */
export function SphereEyebrow({ domainKey, label }: { domainKey: DomainKey; label: string }) {
  return <p className="flex items-center gap-2"><DomainIcon domain={domainKey} size="sm" />
    <span className={cn("text-[11px] leading-4 font-semibold tracking-[0.02em] uppercase", eyebrowTones[domainPresentation[domainKey].tone])}>{label}</span></p>;
}
/** Small caps caption of a panel (`.cap`). */
export function Cap({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[11px] leading-4 font-semibold tracking-[0.02em] text-muted-foreground uppercase", className)}>{children}</p>;
}
/** «Как считать · Увеличить до значения» rows of a preview (`.kv`). */
export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex gap-2 text-xs leading-[18px]"><dt className="w-24 shrink-0 text-muted-foreground">{label}</dt><dd className="min-w-0 wrap-anywhere tabular-nums">{children}</dd></div>;
}
/** The ticked square of mockups 25–27 (`.box.on`), decorative next to a text that says the same. */
export function TickBox({ on }: { on: boolean }) {
  return <span aria-hidden="true" className={cn("inline-flex size-[18px] shrink-0 items-center justify-center rounded-[6px] border-[1.5px]",
    on ? "border-primary bg-primary text-primary-foreground" : "border-border-strong")}>{on && <Check className="size-3" strokeWidth={3} />}</span>;
}

const optionClass = "relative flex min-w-0 cursor-pointer gap-3 rounded-[14px] border bg-card text-sm leading-5 font-semibold text-foreground transition-colors duration-[120ms] hover:border-border-strong "
  + "has-[:checked]:border-primary has-[:checked]:bg-primary/6 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring "
  + "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50";
const radioClass = "size-[18px] shrink-0 cursor-pointer appearance-none rounded-full border-[1.5px] border-border-strong checked:border-primary checked:bg-primary checked:shadow-[inset_0_0_0_4px_var(--card)] focus-visible:outline-none";
const checkboxClass = "peer size-[18px] shrink-0 cursor-pointer appearance-none rounded-[6px] border-[1.5px] border-border-strong checked:border-primary checked:bg-primary focus-visible:outline-none disabled:cursor-not-allowed";

/**
 * One answer option (`.opt`): a radio for one choice, a checkbox for several. `dashed` marks «✎ Свой вариант».
 * `trailing` puts the control on the right (sphere cards of step 1).
 */
export function OptionCard({ type, name, value, checked, disabled, onChange, label, description, icon, dashed, trailing, compact, className }: {
  type: "radio" | "checkbox"; name: string; value: string; checked: boolean; disabled?: boolean; onChange(checked: boolean): void;
  label: ReactNode; description?: string | null; icon?: ReactNode; dashed?: boolean; trailing?: boolean; compact?: boolean; className?: string;
}) {
  // A language chip (mockup 29) shows no circle: the radio covers the chip, the border shows the choice.
  const control = type === "radio"
    ? <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onChange(true)}
      className={compact ? "absolute inset-0 size-full cursor-pointer appearance-none rounded-[14px] opacity-0" : radioClass} />
    : <span className="relative inline-flex">
      <input type="checkbox" name={name} value={value} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className={checkboxClass} />
      <Check aria-hidden="true" strokeWidth={3} className="pointer-events-none absolute inset-0 m-auto hidden size-3 text-primary-foreground peer-checked:block" />
    </span>;
  return <label className={cn(optionClass, compact ? "items-center px-3 py-2 text-[13px]" : description || trailing ? "items-start px-4 py-[13px]" : "items-center px-4 py-[13px]",
    dashed && "border-dashed", className)}>
    {!trailing && (compact && type === "radio" ? control : <span className={cn("flex", description && !compact && "pt-px")}>{control}</span>)}
    {icon}
    <span className="grid min-w-0 flex-1 gap-1"><span>{label}</span>{description && <span className="text-xs leading-[18px] font-normal text-muted-foreground">{description}</span>}</span>
    {trailing && <span className="flex pt-px">{control}</span>}
  </label>;
}

export const fieldId = (...parts: string[]) => `onb-${parts.join("-")}`;

/** A number as typed («3 000», «21,1»): kept as text, checked when the goal is built. */
export function NumberField({ id, label, value, onChange, error, placeholder, className }: { id: string; label: ReactNode; value: string; onChange(value: string): void; error?: string; placeholder?: string; className?: string }) {
  return <div className={cn("grid min-w-0 content-start gap-1.5", className)}>
    <label htmlFor={id} className="field-label">{label}</label>
    <input id={id} type="text" inputMode="decimal" autoComplete="off" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)}
      aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} className="field-control tabular-nums" />
    {error && <p id={`${id}-error`} className="text-sm leading-5 text-destructive">{error}</p>}
  </div>;
}
export function TextField({ id, label, value, onChange, error, placeholder, maxLength, multiline, labelClassName = "field-label", className }: { id: string; label: ReactNode; value: string; onChange(value: string): void; error?: string; placeholder?: string; maxLength: number; multiline?: boolean; labelClassName?: string; className?: string }) {
  const common = { id, value, placeholder, maxLength, onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    "aria-invalid": error ? true : undefined, "aria-describedby": error ? `${id}-error` : undefined } as const;
  return <div className={cn("grid min-w-0 content-start gap-1.5", className)}>
    <label htmlFor={id} className={labelClassName}>{label}</label>
    {multiline ? <textarea {...common} rows={2} className="field-control min-h-16 resize-y text-sm" /> : <input {...common} type="text" autoComplete="off" className="field-control" />}
    {error && <p id={`${id}-error`} className="text-sm leading-5 text-destructive">{error}</p>}
  </div>;
}
/** «Срок · необязательно»: a date in the zone the wizard uses; the goal ends with that day there (as «Новая цель»). */
export function DeadlineField({ id, label = "Срок", value, timeZone, onChange, error, className }: { id: string; label?: string; value: string | null; timeZone: string; onChange(value: string | null): void; error?: string; className?: string }) {
  return <div className={cn("grid min-w-0 content-start gap-1.5", className)}>
    <label htmlFor={id} className="field-label">{label} <span className="font-normal text-text-3">· необязательно</span></label>
    <input id={id} type="date" value={deadlineDate(value, timeZone)} className="field-control tabular-nums" aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      onChange={(event) => {
        const date = event.target.value;
        if (!date) { onChange(null); return; }
        try { onChange(endOfLocalDay(date, timeZone)); } catch { /* a partly typed date stays in the field until it is complete */ }
      }} />
    {error && <p id={`${id}-error`} className="text-sm leading-5 text-destructive">{error}</p>}
  </div>;
}
/**
 * A1…C2 as six radio cells (`.lvl`, mockup 29); the stored value is 1…6. The current level is filled (`.was`), the target
 * one has the accent border (`.on`).
 */
export function LevelGrid({ name, legend, value, onChange, error, hint, current = false }: { name: string; legend: string; value: string; onChange(value: string): void; error?: string; hint?: string; current?: boolean }) {
  const chosen = current ? "has-[:checked]:bg-surface-3 has-[:checked]:text-foreground" : "has-[:checked]:border-primary has-[:checked]:bg-primary/6 has-[:checked]:text-foreground";
  const described = [hint ? `${name}-hint` : null, error ? `${name}-error` : null].filter(Boolean).join(" ") || undefined;
  return <fieldset className="grid min-w-0 gap-1.5" aria-describedby={described}>
    <legend className="field-label mb-1.5">{legend}</legend>
    <div className="grid grid-cols-6 gap-1.5">
      {LANGUAGE_LEVELS.map((level, index) => {
        const stored = String(index + 1);
        return <label key={level} className={cn("relative flex h-[38px] cursor-pointer items-center justify-center rounded-[10px] border text-[13px] font-semibold text-muted-foreground transition-colors duration-[120ms] hover:border-border-strong has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring", chosen)}>
          <input type="radio" name={name} value={stored} checked={value === stored} onChange={() => onChange(stored)} aria-invalid={error ? true : undefined}
            className="absolute inset-0 size-full cursor-pointer appearance-none rounded-[10px] opacity-0" />{level}
        </label>;
      })}
    </div>
    {hint && <p id={`${name}-hint`} className="text-xs leading-5 text-muted-foreground">{hint}</p>}
    {error && <p id={`${name}-error`} className="text-sm leading-5 text-destructive">{error}</p>}
  </fieldset>;
}
