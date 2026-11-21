"use client";

import type { Ref } from "react";
import { cn } from "cn";
import type { DomainKey, OnboardingChoice, OnboardingSphereAnswer, UserPreferences } from "@lifeos/contracts";
import { findOnboardingOption, newOnboardingChoice, ONBOARDING_QUESTIONS } from "@lifeos/domain/onboarding";
import type { OnboardingProposal } from "@lifeos/domain/onboarding";
import { proposalRange } from "../../lib/onboarding-presentation.ts";
import { FormAlert } from "../auth/form-parts.tsx";
import { ChoiceEditor } from "./choice-editor.tsx";
import { OptionCard, SphereEyebrow, TickBox } from "./controls.tsx";

export const EMPTY_SPHERE: OnboardingSphereAnswer = Object.freeze({ skipped: false, choices: [] }) as OnboardingSphereAnswer;

/**
 * One question of a chosen sphere (mockups 25, 26, 29): options of catalog v1, «Свой вариант» and the numbers. Health
 * takes up to three choices; the others one. Every choice is edited in place, the others stay as one-line summaries.
 */
export function QuestionStep({ domainKey, label, sphere, proposals, showIssues, missingChoice, timeZone, preferences, active, onActiveChange, onChange, headingRef, headingId }: {
  domainKey: DomainKey; label: string; sphere: OnboardingSphereAnswer; proposals: OnboardingProposal[]; showIssues: boolean; missingChoice: boolean;
  timeZone: string; preferences: UserPreferences; active: string | null; onActiveChange(option: string | null): void;
  onChange(sphere: OnboardingSphereAnswer): void; headingRef: Ref<HTMLHeadingElement>; headingId: string;
}) {
  const question = ONBOARDING_QUESTIONS[domainKey];
  const multiple = question.limit > 1;
  const chosen = sphere.choices.map((choice) => choice.option);
  const proposalOf = (option: string) => proposals.find((proposal) => proposal.key === `${domainKey}.${option}`);
  const replace = (option: string, next: OnboardingChoice) => onChange({ ...sphere, choices: sphere.choices.map((choice) => choice.option === option ? next : choice) });
  function toggle(option: string, checked: boolean) {
    if (!multiple) {
      if (!chosen.includes(option)) onChange({ skipped: false, choices: [newOnboardingChoice(domainKey, option)] });
      return;
    }
    if (checked) {
      if (chosen.includes(option) || chosen.length >= question.limit) return;
      onChange({ skipped: false, choices: [...sphere.choices, newOnboardingChoice(domainKey, option)] });
      onActiveChange(option);
    } else {
      const rest = sphere.choices.filter((choice) => choice.option !== option);
      onChange({ ...sphere, choices: rest });
      if (active === option) onActiveChange(rest.at(-1)?.option ?? null);
    }
  }
  const expanded = multiple ? (chosen.includes(active ?? "") ? active : chosen.at(-1) ?? null) : chosen[0] ?? null;
  const grid = question.layout === "chips" ? "flex flex-wrap gap-2" : question.layout === "tiles" ? "grid grid-cols-2 gap-2.5 lg:grid-cols-3" : "grid gap-2.5 sm:grid-cols-2";

  return <div className="grid min-w-0 gap-3.5 md:gap-[18px]">
    <fieldset className="grid min-w-0 gap-3.5 md:gap-[18px]" aria-describedby={`${headingId}-lead`}>
      <legend className="grid w-full gap-1.5 pb-1.5">
        <SphereEyebrow domainKey={domainKey} label={label} />
        <h1 ref={headingRef} id={headingId} tabIndex={-1} className="text-[22px] leading-7 font-bold tracking-[-0.01em] focus:outline-none md:text-[26px] md:leading-8">{question.question}</h1>
      </legend>
      {/* The rendered legend is outside the grid flow: the lead follows it with the 6px of the mockup (`.col.gap6`). */}
      <p id={`${headingId}-lead`} className="text-sm leading-5 text-muted-foreground">{question.lead}</p>
      {missingChoice && <FormAlert tone="error">Выберите вариант или нажмите «Пропустить вопрос».</FormAlert>}
      <div className={grid} data-testid="onboarding-options">
        {question.options.map((option) => {
          const checked = chosen.includes(option.key);
          const own = option.key === "own" || option.key === "other";
          return <OptionCard key={option.key} type={multiple ? "checkbox" : "radio"} name={`onb-${domainKey}-option`} value={option.key} checked={checked}
            disabled={multiple && !checked && chosen.length >= question.limit} onChange={(value) => toggle(option.key, value)}
            label={own ? <><span aria-hidden="true">✎ </span>{option.label}</> : option.label} description={question.layout === "cards" ? option.description : null}
            dashed={own} compact={question.layout === "chips"} />;
        })}
      </div>
    </fieldset>
    {sphere.choices.map((choice) => {
      const proposal = proposalOf(choice.option);
      if (choice.option === expanded) {
        const option = findOnboardingOption(domainKey, choice.option);
        return <ChoiceEditor key={choice.option} domainKey={domainKey} choice={choice} proposal={proposal} showIssues={showIssues} timeZone={timeZone}
          highlighted={multiple && option?.key === "own"} subtitle={multiple && option?.key !== "own" ? option?.label : undefined}
          onChange={(next) => replace(choice.option, next)} />;
      }
      return <CollapsedChoice key={choice.option} domainKey={domainKey} choice={choice} proposal={proposal} invalid={showIssues && !!proposal?.issues.length}
        preferences={preferences} onEdit={() => onActiveChange(choice.option)} />;
    })}
  </div>;
}

/** «✓ Регулярные тренировки · 0 → 3 тренировок в неделю · Изменить» (mockup 26). */
function CollapsedChoice({ domainKey, choice, proposal, invalid, preferences, onEdit }: { domainKey: DomainKey; choice: OnboardingChoice; proposal: OnboardingProposal | undefined; invalid: boolean; preferences: UserPreferences; onEdit(): void }) {
  const option = findOnboardingOption(domainKey, choice.option);
  const title = option?.key === "own" ? choice.subject.trim() || "Свой вариант" : option?.label ?? choice.option;
  return <div className={cn("flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border bg-surface-2 px-4 py-3", invalid && "border-destructive")}>
    <TickBox on />
    <span className="min-w-0 text-sm leading-5 font-semibold wrap-anywhere">{title}</span>
    {proposal && <span className="text-xs leading-5 text-muted-foreground tabular-nums">· {proposalRange(proposal.draft, preferences.locale)}</span>}
    {invalid && <span className="text-xs leading-5 text-destructive">Проверьте цифры</span>}
    <button type="button" onClick={onEdit} aria-label={`Изменить: ${title}`} className="ml-auto rounded-md text-xs leading-5 font-medium text-primary hover:underline">Изменить</button>
  </div>;
}
