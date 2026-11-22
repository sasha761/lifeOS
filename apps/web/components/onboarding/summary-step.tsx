"use client";

import { useState } from "react";
import type { FormEvent, Ref } from "react";
import { Check } from "lucide-react";
import { cn } from "cn";
import { createGoalInputSchema, DOMAIN_KEYS } from "@lifeos/contracts";
import type { CreateGoalInput, DomainKey, OnboardingAnswers, OnboardingChoice, UserPreferences } from "@lifeos/contracts";
import { buildOnboardingGoals } from "@lifeos/domain/onboarding";
import type { OnboardingProposal } from "@lifeos/domain/onboarding";
import { plural } from "../../lib/dashboard-presentation.ts";
import { goalFormInput } from "../../lib/goal-form-input.ts";
import type { GoalFieldErrors } from "../../lib/goal-form-input.ts";
import { GOAL_FORMS, issueMessage, proposalLine } from "../../lib/onboarding-presentation.ts";
import { focusFirstInvalid } from "../auth/form-parts.tsx";
import { GoalFields } from "../goals/goal-form.tsx";
import { Modal } from "../goals/shared.tsx";
import { DomainIcon } from "../ui/domain-icon.tsx";
import { StatusChip } from "../ui/status-chip.tsx";
import { ChoiceEditor } from "./choice-editor.tsx";
import { Cap, TickBox } from "./controls.tsx";
import type { SphereLabels } from "./preview-panel.tsx";
import { headingClass } from "./steps.tsx";

const ghostButton = "action-link-secondary action-sm shrink-0 bg-transparent text-muted-foreground hover:text-foreground";
const checkboxClass = "peer size-[18px] shrink-0 cursor-pointer appearance-none rounded-[6px] border-[1.5px] border-border-strong checked:border-primary checked:bg-primary disabled:cursor-not-allowed disabled:opacity-60";

function listOf(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} и ${names.at(-1)}`;
}

/**
 * Summary (mockup 27): every proposed goal with a tick and «Изменить», skipped spheres with «Ответить сейчас» and
 * «+ Добавить цель в другой сфере». Nothing is created before «Создать N целей».
 */
export function SummaryStep({ answers, proposals, labels, preferences, failedKey, onToggle, onEdit, onRemoveExtra, onAnswerNow, onAddExtra, headingRef, headingId }: {
  answers: OnboardingAnswers; proposals: OnboardingProposal[]; labels: SphereLabels; preferences: UserPreferences; failedKey: string | null;
  onToggle(key: string, checked: boolean): void; onEdit(proposal: OnboardingProposal): void; onRemoveExtra(index: number): void;
  onAnswerNow(domainKey: DomainKey): void; onAddExtra(): void; headingRef: Ref<HTMLHeadingElement>; headingId: string;
}) {
  const valid = proposals.filter((proposal) => proposal.input !== null).length;
  const skipped = answers.domains.filter((key) => !proposals.some((proposal) => proposal.domainKey === key && proposal.source !== "extra"));
  const others = DOMAIN_KEYS.filter((key) => !answers.domains.includes(key));
  return <div className="grid min-w-0 gap-3.5 md:gap-[22px]">
    <div className="grid gap-1.5">
      <h1 ref={headingRef} id={headingId} tabIndex={-1} className={headingClass}><span className="md:hidden">Проверьте цели</span><span className="hidden md:inline">Проверьте цели перед созданием</span></h1>
      <p className="text-sm leading-5 text-muted-foreground">
        {valid === 0 ? "По ответам целей пока нет. Ответьте на пропущенные вопросы или добавьте цель в другой сфере."
          : <>
            <span className="md:hidden">Получилось {valid} {plural(valid, GOAL_FORMS)}. Снимите галочку с лишних.</span>
            <span className="hidden md:inline">По вашим ответам получилось <strong className="font-semibold text-foreground">{valid} {plural(valid, GOAL_FORMS)}</strong>. Снимите галочку, если цель не нужна, или поправьте цифры.</span>
          </>}
      </p>
    </div>
    <ul className="grid gap-2.5" aria-label="Предложенные цели">
      {proposals.map((proposal) => {
        const checked = proposal.input !== null && !answers.unchecked.includes(proposal.key);
        const failed = failedKey === proposal.key;
        const extra = proposal.source === "extra";
        return <li key={proposal.key} className={cn("flex min-w-0 items-center gap-3 rounded-2xl border bg-card px-3.5 py-3 sm:gap-3.5 sm:px-[18px] sm:py-3.5", failed && "border-destructive")}
          data-testid={`onboarding-summary-${proposal.key}`}>
          <span className="relative inline-flex">
            <input type="checkbox" checked={checked} disabled={proposal.input === null} onChange={(event) => onToggle(proposal.key, event.target.checked)}
              aria-label={`Создать цель «${proposal.draft.title}»`} className={checkboxClass} />
            <TickMark />
          </span>
          <DomainIcon domain={proposal.domainKey} className="max-sm:size-[22px] max-sm:rounded-[7px]" />
          <div className="grid min-w-0 flex-1 gap-1">
            <p className="text-sm leading-5 font-bold wrap-anywhere">{proposal.draft.title || "Без названия"}</p>
            <p className="text-xs leading-[18px] text-muted-foreground tabular-nums wrap-anywhere">
              <span className="sm:hidden">{proposalLine(proposal, preferences, { direction: false })}</span><span className="max-sm:hidden">{proposalLine(proposal, preferences)}</span></p>
            {proposal.issues.length > 0 && <p className="text-xs leading-5 text-destructive">{issueMessage(proposal.issues[0]!, proposal)}</p>}
            {failed && <p role="alert" className="text-xs leading-5 text-destructive">Сервер не принял эту цель. Поправьте цифры и создайте цели снова — пока ничего не создано.</p>}
          </div>
          <span className="hidden sm:inline-flex">{proposal.source === "answer" ? <StatusChip tone="outline">из ответа</StatusChip> : <StatusChip tone="primary">свой вариант</StatusChip>}</span>
          {extra
            ? <button type="button" className={ghostButton} onClick={() => onRemoveExtra(Number(proposal.key.split(".")[1]))} aria-label={`Убрать цель «${proposal.draft.title}»`}>Убрать</button>
            : <button type="button" className={ghostButton} onClick={() => onEdit(proposal)} aria-label={`Изменить цель «${proposal.draft.title}»`}>Изменить</button>}
        </li>;
      })}
      {skipped.map((key) => <li key={key} className="flex min-w-0 items-center gap-3 rounded-2xl border bg-card/60 px-3.5 py-3 sm:gap-3.5 sm:px-[18px] sm:py-3.5" data-testid={`onboarding-skipped-${key}`}>
        <TickBox on={false} />
        <DomainIcon domain={key} className="opacity-60 max-sm:size-[22px] max-sm:rounded-[7px]" />
        <div className="grid min-w-0 flex-1 gap-1"><p className="text-sm leading-5 font-bold text-muted-foreground">{labels[key]}</p>
          <p className="text-xs leading-[18px] text-muted-foreground">Вопрос пропущен. Цель можно добавить позже на странице сферы.</p></div>
        <button type="button" className={ghostButton} onClick={() => onAnswerNow(key)} aria-label={`Ответить сейчас: ${labels[key]}`}>Ответить сейчас</button>
      </li>)}
    </ul>
    {others.length > 0 && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[14px] border-[1.5px] border-dashed border-border-strong px-[18px] py-3">
      <p className="text-xs leading-5 text-muted-foreground">{listOf(others.map((key) => labels[key]))} вы не выбрали.</p>
      {answers.extra.length < 6 && <button type="button" onClick={onAddExtra} className="ml-auto rounded-md text-xs leading-5 font-medium text-primary hover:underline">+ Добавить цель в другой сфере</button>}
    </div>}
  </div>;
}
function TickMark() {
  return <Check aria-hidden="true" strokeWidth={3} className="pointer-events-none absolute inset-0 m-auto hidden size-3 text-primary-foreground peer-checked:block" />;
}

/**
 * Right panel of the summary (mockup 27 without its «Ритм» card, removed by LFS-222): what happens after «Создать». The
 * card's «Главная» line moved into the second step.
 */
export function SummaryAside({ answers, selected }: { answers: OnboardingAnswers; selected: number }) {
  const steps = [
    selected > 0 ? `Создадим ${selected} ${plural(selected, GOAL_FORMS)}. Каждая попадёт в журнал действий как обычная.` : "Отметьте цели, которые нужно создать.",
    answers.domains.length > 0 ? "Откроется Кабинет, выбранные сферы будут первыми." : "Откроется Кабинет с вашими сферами.",
    "Первое измерение добавите, когда будете готовы. Прогресс считается только по вашим данным.",
  ];
  return <aside aria-label="Что будет дальше" className="grid min-w-0 content-start gap-3.5">
    <div className="grid gap-2.5 rounded-2xl border bg-card px-5 py-[18px]">
      <Cap>Что будет дальше</Cap>
      <ol className="grid gap-2.5 text-xs leading-5">
        {steps.map((text, index) => <li key={index} className="flex items-start gap-2.5"><StatusChip tone="outline" className="tabular-nums">{index + 1}</StatusChip><span>{text}</span></li>)}
      </ol>
    </div>
  </aside>;
}

/** «Изменить» on the summary: the editor of the step in a dialog; «Готово» keeps the change only if the goal is valid. */
export function EditChoiceDialog({ answers, domainKey, choice, preferences, timeZone, label, close, save }: {
  answers: OnboardingAnswers; domainKey: DomainKey; choice: OnboardingChoice; preferences: UserPreferences; timeZone: string; label: string;
  close(): void; save(choice: OnboardingChoice): void;
}) {
  const [draft, setDraft] = useState(choice);
  const [checked, setChecked] = useState(false);
  const sphere = answers.spheres[domainKey];
  const preview = buildOnboardingGoals({ ...answers, spheres: { ...answers.spheres, [domainKey]: { skipped: false,
    choices: (sphere?.choices ?? []).map((candidate) => candidate.option === draft.option ? draft : candidate) } } })
    .find((proposal) => proposal.key === `${domainKey}.${draft.option}`);
  function done(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview?.input) { setChecked(true); focusFirstInvalid(event.currentTarget); return; }
    save(draft);
  }
  return <Modal title="Изменить цель" close={close}>
    <form onSubmit={done} noValidate className="grid gap-3.5">
      <p className="text-xs leading-5 text-muted-foreground">{label}: {preview?.draft.title ?? ""}</p>
      <ChoiceEditor domainKey={domainKey} choice={draft} proposal={preview} showIssues={checked} timeZone={timeZone} onChange={setDraft} narrow className="border-0 bg-transparent px-0 py-0 sm:px-0" />
      <p className="text-xs leading-5 text-muted-foreground">{preview ? proposalLine(preview, { ...preferences, timezone: timeZone }) : ""}</p>
      <div className="flex flex-wrap justify-end gap-2.5">
        <button type="button" onClick={close} className="action-link-secondary action-compact">Отмена</button>
        <button type="submit" className="action-link action-compact">Готово</button>
      </div>
    </form>
  </Modal>;
}

/**
 * «+ Добавить цель в другой сфере»: the fields of «Новая цель» (mockup 10) for a sphere that was not chosen. The goal is
 * added to the summary list and created with the others by «Создать N целей» (owner decision 2026-11-20).
 */
export function ExtraGoalDialog({ domains, preferences, close, add }: { domains: { key: DomainKey; label: string }[]; preferences: UserPreferences; close(): void; add(goal: CreateGoalInput): void }) {
  const [errors, setErrors] = useState<GoalFieldErrors>({});
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const result = goalFormInput(new FormData(form), preferences.timezone);
    if (result.errors) { setErrors(result.errors); focusFirstInvalid(form); return; }
    // goalFormInput without `editing` validates by the creation contract; the parse narrows the type.
    const goal = createGoalInputSchema.safeParse(result.data);
    if (goal.success) add(goal.data);
  }
  return <Modal title="Цель в другой сфере" close={close}>
    <form onSubmit={submit} noValidate className="grid gap-3.5">
      <GoalFields domainKey={domains[0]?.key} domains={domains} preferences={preferences} errors={errors} />
      <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
        <p className="mr-auto basis-60 text-xs leading-5 text-muted-foreground">Цель создастся вместе с остальными по кнопке «Создать».</p>
        <button type="button" onClick={close} className="action-link-secondary action-compact">Отмена</button>
        <button type="submit" className="action-link action-compact">Добавить в список</button>
      </div>
    </form>
  </Modal>;
}
