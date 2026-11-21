"use client";

import { cn } from "cn";
import { GOAL_UNIT_LABEL_MAX_LENGTH } from "@lifeos/contracts";
import type { DomainKey, OnboardingChoice } from "@lifeos/contracts";
import { findOnboardingOption, ONBOARDING_QUESTIONS } from "@lifeos/domain/onboarding";
import type { OnboardingIssueField, OnboardingProposal } from "@lifeos/domain/onboarding";
import { goalUnitOptionLabel } from "../../lib/goal-presentation.ts";
import { DIRECTION_LABELS, issueMessage } from "../../lib/onboarding-presentation.ts";
import { SegmentedChoice } from "../ui/segmented-choice.tsx";
import { DeadlineField, fieldId, LevelGrid, NumberField, TextField } from "./controls.tsx";

const DIRECTIONS = [{ value: "increase", label: DIRECTION_LABELS.increase }, { value: "decrease", label: DIRECTION_LABELS.decrease }] as const;
const CURRENCIES = [{ value: "NOK", label: "NOK" }, { value: "USD", label: "USD" }] as const;

/**
 * «Уточните цифры» of one chosen option (mockup 25), «Свой вариант» (mockup 26) or the language levels (mockup 29).
 * The same editor opens from «Изменить» on the summary. Messages appear next to the field once the step was checked.
 */
export function ChoiceEditor({ domainKey, choice, proposal, showIssues, timeZone, onChange, highlighted = false, subtitle, narrow = false, className }: {
  domainKey: DomainKey; choice: OnboardingChoice; proposal: OnboardingProposal | undefined; showIssues: boolean; timeZone: string;
  onChange(choice: OnboardingChoice): void; highlighted?: boolean; subtitle?: string;
  /** Two columns at any width: the dialog of «Изменить» on the summary is 560px wide. */
  narrow?: boolean; className?: string;
}) {
  const option = findOnboardingOption(domainKey, choice.option);
  if (!option) return null;
  const error = (field: OnboardingIssueField) => showIssues && proposal?.issues.includes(field) ? issueMessage(field, proposal) : undefined;
  const id = (part: string) => fieldId(domainKey, choice.option, part);
  const set = (changes: Partial<OnboardingChoice>) => onChange({ ...choice, ...changes });
  const number = (field: "baseline" | "target", label: string) =>
    <NumberField key={field} id={id(field)} label={label} value={choice[field]} error={error(field)} onChange={(value) => set({ [field]: value })} />;
  const deadline = (label?: string) => <DeadlineField id={id("due")} label={label} value={choice.due_at} timeZone={timeZone} error={error("due_at")} onChange={(due_at) => set({ due_at })} />;
  const card = cn("grid min-w-0 gap-3.5 rounded-2xl border bg-surface-2 px-4 py-4 sm:px-[18px]", highlighted && "border-primary bg-primary/6", className);

  if (option.unit.kind === "own") {
    const units = ONBOARDING_QUESTIONS[domainKey].ownUnits;
    const unitText = choice.unit === "custom" ? choice.unit_label : goalUnitOptionLabel(choice.unit);
    return <div className={card} data-testid={`onboarding-editor-${domainKey}-${choice.option}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><h2 className="text-sm leading-5 font-bold">Свой вариант</h2>
        <p className="text-xs leading-5 text-muted-foreground sm:ml-auto">напишите цель так, как сказали бы себе</p></div>
      <TextField id={id("subject")} label="Название цели" labelClassName="sr-only" multiline maxLength={option.subject?.maxLength ?? 120} value={choice.subject}
        placeholder={option.subject?.placeholder} error={error("subject")} onChange={(subject) => set({ subject })} />
      <SegmentedChoice key={id("direction")} name={id("direction")} legend="Как будем считать прогресс" options={DIRECTIONS} defaultValue={choice.direction}
        error={error("direction")} onValueChange={(value) => set({ direction: value as OnboardingChoice["direction"] })} />
      <div className={cn("grid grid-cols-2 items-start gap-2.5", !narrow && "sm:grid-cols-[1.3fr_0.8fr_0.8fr_1fr]")}>
        <TextField id={id("unit")} label="Единица" className={cn("col-span-2", !narrow && "sm:col-span-1")} maxLength={GOAL_UNIT_LABEL_MAX_LENGTH} value={unitText} error={error("unit_label")}
          placeholder="например, км" onChange={(value) => set({ unit: "custom", unit_label: value })} />
        {number("baseline", "Сейчас")}
        {number("target", "Цель")}
        <div className={cn("col-span-2", !narrow && "sm:col-span-1")}>{deadline()}</div>
      </div>
      {units.length > 0 && <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] leading-4 text-muted-foreground" id={id("units")}>Частые единицы:</span>
        {units.map((unit) => {
          const label = unit.unit === "custom" ? unit.unit_label! : goalUnitOptionLabel(unit.unit);
          const pressed = choice.unit === unit.unit && (unit.unit !== "custom" || choice.unit_label === unit.unit_label);
          return <button key={label} type="button" aria-pressed={pressed} aria-describedby={id("units")}
            onClick={() => set({ unit: unit.unit, unit_label: unit.unit_label ?? "" })}
            className={cn("inline-flex min-h-6 items-center rounded-full border px-2 py-0.5 text-[11px] leading-4 font-semibold transition-colors duration-[120ms] hover:border-primary pointer-coarse:min-h-9",
              pressed ? "border-primary bg-primary/15 text-foreground" : "border-border-strong text-muted-foreground")}>{label}</button>;
        })}
      </div>}
      {option.hint && <p className="text-xs leading-5 text-muted-foreground">{option.hint}</p>}
    </div>;
  }

  if (option.unit.kind === "level") {
    return <div className={card} data-testid={`onboarding-editor-${domainKey}-${choice.option}`}>
      <h2 className="text-sm leading-5 font-bold">Уточните уровень{subtitle ? <span className="font-normal text-muted-foreground"> · {subtitle}</span> : null}</h2>
      {option.subject && <TextField id={id("subject")} label={option.subject.label} maxLength={option.subject.maxLength} value={choice.subject}
        placeholder={option.subject.placeholder} error={error("subject")} onChange={(subject) => set({ subject })} />}
      <LevelGrid current name={id("baseline")} legend="Ваш уровень сейчас" value={choice.baseline} hint={option.hint ?? undefined} error={error("baseline")} onChange={(baseline) => set({ baseline })} />
      <LevelGrid name={id("target")} legend="Хочу достичь" value={choice.target} error={error("target")} onChange={(target) => set({ target })} />
      <div className="sm:max-w-64">{deadline("К какому сроку")}</div>
    </div>;
  }

  const [first, second] = option.numbers;
  const currency = option.unit.kind === "currency";
  return <div className={card} data-testid={`onboarding-editor-${domainKey}-${choice.option}`}>
    <h2 className="text-sm leading-5 font-bold">Уточните цифры{subtitle ? <span className="font-normal text-muted-foreground"> · {subtitle}</span> : null}</h2>
    {option.subject && <TextField id={id("subject")} label={<>{option.subject.label} <span className="font-normal text-text-3">· необязательно</span></>}
      maxLength={option.subject.maxLength} value={choice.subject} placeholder={option.subject.placeholder} error={error("subject")} onChange={(subject) => set({ subject })} />}
    <div className={cn("grid grid-cols-2 items-start gap-2.5", !narrow && (currency ? "sm:grid-cols-[1.1fr_0.9fr_1fr_1fr]" : "sm:grid-cols-3"))}>
      {number(first.field, first.label)}
      {currency && <SegmentedChoice key={id("currency")} name={id("currency")} legend="Валюта" options={CURRENCIES} defaultValue={choice.unit}
        error={error("unit")} onValueChange={(value) => set({ unit: value as OnboardingChoice["unit"] })} />}
      {number(second.field, second.label)}
      <div className={cn(!currency && "col-span-2", !currency && !narrow && "sm:col-span-1")}>{deadline()}</div>
    </div>
    {option.hint && <p className="text-xs leading-5 text-muted-foreground">{option.hint}</p>}
  </div>;
}
