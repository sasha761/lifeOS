"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { cn } from "cn";
import { DOMAIN_KEYS, onboardingCompletedSchema, onboardingStateSchema } from "@lifeos/contracts";
import type { DomainKey, OnboardingAnswers, OnboardingSphereAnswer, OnboardingState, OnboardingStep, UserPreferences } from "@lifeos/contracts";
import { buildOnboardingGoals, emptyOnboardingAnswers, ONBOARDING_QUESTIONS, selectedOnboardingGoals } from "@lifeos/domain/onboarding";
import type { OnboardingProposal } from "@lifeos/domain/onboarding";
import { plural } from "../../lib/dashboard-presentation.ts";
import { createGoalCommand, GoalRequestError } from "../../lib/goals-api-client.ts";
import { currentOnboardingStep, GOAL_FORMS, isSphereStep, moveDeadlines, onboardingSteps } from "../../lib/onboarding-presentation.ts";
import { FormAlert } from "../auth/form-parts.tsx";
import type { SphereLabels } from "./preview-panel.tsx";
import { QuestionPreview } from "./preview-panel.tsx";
import { EMPTY_SPHERE, QuestionStep } from "./question-step.tsx";
import { RhythmPreview, RhythmStep, SpheresStep } from "./steps.tsx";
import { EditChoiceDialog, ExtraGoalDialog, SummaryAside, SummaryStep } from "./summary-step.tsx";

const HEADING_ID = "onboarding-step-title";
const ghost = "action-link-secondary action-compact bg-transparent text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-45";
function signIn() { window.location.assign(`/auth/sign-in?next=${encodeURIComponent("/onboarding")}`); }

/**
 * Onboarding wizard (LFS-219, mockups 24–27 and 29): spheres → one question per chosen sphere → rhythm → summary.
 * The answers live in this component until «Сохранить и выйти» (a server draft) or «Создать N целей» (one transaction).
 * After «Далее» and «Назад» the focus moves to the heading of the new step.
 */
export function OnboardingWizard({ initial, preferences, labels, timeZones }: { initial: OnboardingState; preferences: UserPreferences; labels: SphereLabels; timeZones: string[] }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<OnboardingAnswers>(() => initial.answers ?? emptyOnboardingAnswers());
  const [missing, setMissing] = useState<OnboardingStep | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<DomainKey>>(new Set());
  const [active, setActive] = useState<Partial<Record<DomainKey, string | null>>>({});
  const [returnToSummary, setReturnToSummary] = useState(false);
  const [editing, setEditing] = useState<OnboardingProposal | null>(null);
  const [addingExtra, setAddingExtra] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<{ message: string; uncertain: boolean } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const saveClient = useRef<ReturnType<typeof createGoalCommand> | null>(null);
  const createClient = useRef<ReturnType<typeof createGoalCommand> | null>(null);
  const retry = useRef<{ url: string; method: "POST"; body: unknown } | null>(null);
  const shownStep = useRef<OnboardingStep | null>(null);

  const step = currentOnboardingStep(answers);
  const steps = onboardingSteps(answers);
  const index = steps.indexOf(step);
  const timeZone = answers.timezone ?? preferences.timezone;
  const zoned = useMemo(() => ({ ...preferences, timezone: timeZone }), [preferences, timeZone]);
  const proposals = useMemo(() => buildOnboardingGoals(answers), [answers]);
  const selected = useMemo(() => selectedOnboardingGoals(answers, proposals), [answers, proposals]);

  useEffect(() => {
    // The heading of a new step gets the focus (not on the first render, where the page itself is announced).
    if (shownStep.current !== null && shownStep.current !== step) {
      window.scrollTo({ top: 0 });
      heading.current?.focus();
    }
    shownStep.current = step;
  }, [step]);

  const go = (next: OnboardingStep) => { setMissing(null); setAnswers((current) => ({ ...current, step: next })); };
  const setSphere = (key: DomainKey, sphere: OnboardingSphereAnswer) => setAnswers((current) => ({ ...current, spheres: { ...current.spheres, [key]: sphere } }));
  const following = () => returnToSummary ? "summary" : steps[index + 1] ?? "summary";
  const focusInvalid = () => setTimeout(() => document.querySelector<HTMLElement>("#main-content [aria-invalid='true']")?.focus(), 0);

  function next() {
    if (step === "summary") { void create(); return; }
    if (step === "domains") {
      if (answers.domains.length === 0) { setMissing("domains"); return; }
      go(steps[1]!);
      return;
    }
    if (step === "rhythm") {
      if (answers.rhythm === null) { setMissing("rhythm"); return; }
      setReturnToSummary(false); go("summary");
      return;
    }
    const sphere = answers.spheres[step] ?? EMPTY_SPHERE;
    if (sphere.choices.length === 0) { setMissing(step); return; }
    // A question answered after «Пропустить» counts again: its goals are checked as an answer.
    const answered = { ...answers, spheres: { ...answers.spheres, [step]: { ...sphere, skipped: false } } };
    const invalid = buildOnboardingGoals(answered).find((proposal) => proposal.domainKey === step && proposal.source !== "extra" && proposal.issues.length > 0);
    if (invalid) {
      setChecked((current) => new Set(current).add(step));
      setActive((current) => ({ ...current, [step]: invalid.option }));
      focusInvalid();
      return;
    }
    setSphere(step, { ...sphere, skipped: false });
    const target = following();
    setReturnToSummary(false);
    go(target);
  }
  function skip() {
    if (isSphereStep(step)) setSphere(step, { ...(answers.spheres[step] ?? EMPTY_SPHERE), skipped: true });
    if (step === "rhythm") setAnswers((current) => ({ ...current, rhythm: null }));
    const target = step === "rhythm" ? "summary" : following();
    setReturnToSummary(false);
    go(target);
  }
  function back() {
    if (index <= 0) return;
    setReturnToSummary(false);
    go(steps[index - 1]!);
  }

  async function saveAndExit() {
    if (saving || creating) return;
    setSaving(true); setSaveError(null);
    saveClient.current ??= createGoalCommand();
    try {
      await saveClient.current.run({ url: "/api/v1/onboarding", method: "PUT", body: { answers } }, onboardingStateSchema);
      router.push("/dashboard");
    } catch (error) {
      if (error instanceof GoalRequestError && error.status === 401) { signIn(); return; }
      // A draft is replaced as a whole, so another attempt is always safe.
      saveClient.current = null;
      setSaveError("Не удалось сохранить ответы. Проверьте соединение и попробуйте ещё раз.");
      setSaving(false);
    }
  }
  async function create() {
    const keys = selected.map((proposal) => proposal.key);
    if (creating || saving || keys.length === 0) return;
    setCreating(true); setCreateError(null); setFailedKey(null);
    createClient.current ??= createGoalCommand();
    const command = retry.current ?? { url: "/api/v1/onboarding/complete", method: "POST" as const, body: { answers, selected: keys } };
    try {
      await createClient.current.run(command, onboardingCompletedSchema);
      retry.current = null;
      router.push("/dashboard");
    } catch (error) {
      if (error instanceof GoalRequestError && error.status === 401) { signIn(); return; }
      const uncertain = !(error instanceof GoalRequestError) || error.uncertain;
      retry.current = uncertain ? command : null;
      if (!uncertain) createClient.current = null;
      if (error instanceof GoalRequestError && error.field) setFailedKey(error.field);
      setCreateError({ uncertain, message: error instanceof GoalRequestError && error.field ? "Одна из целей не прошла проверку на сервере. Ни одна цель не создана."
        : error instanceof GoalRequestError && error.status === 409 ? "Этот запрос уже отправлялся с другими данными. Обновите страницу и проверьте Кабинет."
          : error instanceof Error ? error.message : "Не удалось создать цели." });
      setCreating(false);
    }
  }

  function changeTimeZone(zone: string) {
    setAnswers((current) => {
      const from = current.timezone ?? preferences.timezone;
      try { return { ...moveDeadlines(current, from, zone), timezone: zone === preferences.timezone ? null : zone }; }
      catch { return current; }
    });
  }

  const sphere = isSphereStep(step) ? answers.spheres[step] ?? EMPTY_SPHERE : null;
  const stepProposals = isSphereStep(step) && sphere && !sphere.skipped ? proposals.filter((proposal) => proposal.domainKey === step && proposal.source !== "extra") : [];
  const summaryCount = selected.length;
  const nextLabel = step === "summary" ? (creating ? "Создаём…" : createError?.uncertain ? "Повторить создание" : `Создать ${summaryCount} ${plural(summaryCount, GOAL_FORMS)}`)
    : returnToSummary ? "К итогу" : "Далее";
  const hint = step === "domains" ? "Ответы видите только вы. Они нужны, чтобы предложить цели."
    : step === "summary" ? `Выбрано ${summaryCount} ${plural(summaryCount, GOAL_FORMS)}`
      : step === "rhythm" ? "Напоминания включатся вместе с Telegram."
        : ONBOARDING_QUESTIONS[step].limit > 1 ? `Выбрано ${sphere?.choices.length ?? 0} из ${ONBOARDING_QUESTIONS[step].limit}`
          : "Пропущенную сферу можно заполнить позже: + Цель в сфере.";
  const editingChoice = editing && editing.option ? answers.spheres[editing.domainKey]?.choices.find((choice) => choice.option === editing.option) : undefined;
  const otherDomains = DOMAIN_KEYS.filter((key) => !answers.domains.includes(key)).map((key) => ({ key, label: labels[key] }));

  return <div className="flex min-h-dvh flex-col">
    <header className="flex h-[52px] items-center gap-3 border-b border-border/70 px-4 md:h-14 md:px-7">
      <button type="button" onClick={back} disabled={index <= 0} className="inline-flex min-h-11 items-center gap-1 text-[13px] text-muted-foreground disabled:opacity-45 md:hidden">
        <ArrowLeft aria-hidden="true" className="size-4" />Назад</button>
      <span className="hidden items-center gap-3 md:flex">
        <span aria-hidden="true" className="flex size-[26px] items-center justify-center rounded-lg bg-primary text-[13px] font-extrabold text-primary-foreground">L</span>
        <span className="text-sm font-bold">LifeOS</span>
        <span className="text-[13px] text-muted-foreground">/ Начальная настройка</span>
      </span>
      <span className="mx-auto text-[13px] font-semibold md:hidden">{step === "summary" ? "Итог" : `Шаг ${index + 1} из ${steps.length}`}</span>
      <button type="button" onClick={saveAndExit} disabled={saving || creating} aria-label="Сохранить и выйти"
        className="action-link-secondary action-sm min-h-11 border-0 bg-transparent px-0 font-normal text-muted-foreground hover:bg-transparent md:ml-auto md:min-h-7 md:border md:px-2.5 md:font-semibold md:hover:bg-surface-3">
        {saving ? "Сохраняем…" : <><span className="md:hidden">Выйти</span><span className="hidden md:inline">Сохранить и выйти</span></>}</button>
    </header>
    <main id="main-content" tabIndex={-1} className="mx-auto grid w-full max-w-[calc(1180px+2rem)] min-w-0 flex-1 content-start gap-4 px-4 pt-4 pb-6 focus:outline-none md:max-w-[calc(1180px+3rem)] md:gap-[22px] md:px-6 md:pt-6 md:pb-8">
      {saveError && <FormAlert tone="error">{saveError}</FormAlert>}
      <Stepper steps={steps} index={index} labels={labels} answers={answers} />
      {step === "domains" && <SpheresStep labels={labels} domains={answers.domains} missing={missing === "domains"} headingRef={heading} headingId={HEADING_ID}
        onChange={(domains) => { setMissing(null); setAnswers((current) => ({ ...current, domains })); }} />}
      {step !== "domains" && <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-7">
        <div className="grid min-w-0 gap-4">
          {isSphereStep(step) && sphere && <QuestionStep key={step} domainKey={step} label={labels[step]} sphere={sphere} proposals={stepProposals}
            showIssues={checked.has(step)} missingChoice={missing === step} timeZone={timeZone} preferences={zoned}
            active={active[step] ?? null} onActiveChange={(option) => setActive((current) => ({ ...current, [step]: option }))}
            onChange={(next) => { setMissing(null); setSphere(step, next); }} headingRef={heading} headingId={HEADING_ID} />}
          {step === "rhythm" && <RhythmStep rhythm={answers.rhythm} timeZone={timeZone} profileTimeZone={preferences.timezone} timeZones={timeZones} missing={missing === "rhythm"}
            onRhythm={(rhythm) => { setMissing(null); setAnswers((current) => ({ ...current, rhythm })); }} onTimeZone={changeTimeZone} headingRef={heading} headingId={HEADING_ID} />}
          {step === "summary" && <>
            {createError && <FormAlert tone="error">{createError.message}
              {createError.uncertain && <p className="mt-1">Ответы зафиксированы для повтора. Нажмите кнопку ещё раз: повтор не создаст цели второй раз.</p>}</FormAlert>}
            <SummaryStep answers={answers} proposals={proposals} labels={labels} preferences={zoned} failedKey={failedKey} headingRef={heading} headingId={HEADING_ID}
              onToggle={(key, on) => setAnswers((current) => ({ ...current, unchecked: on ? current.unchecked.filter((value) => value !== key) : [...current.unchecked, key] }))}
              onEdit={setEditing} onAddExtra={() => setAddingExtra(true)}
              onRemoveExtra={(position) => setAnswers((current) => ({ ...current, extra: current.extra.filter((_, at) => at !== position),
                // Keys of the extra goals follow their position, so the ticks of the goals after it move with them.
                unchecked: current.unchecked.filter((key) => !key.startsWith("extra.")).concat(current.unchecked.filter((key) => key.startsWith("extra."))
                  .map((key) => Number(key.split(".")[1])).filter((at) => at !== position).map((at) => `extra.${at > position ? at - 1 : at}`)) }))}
              onAnswerNow={(key) => { setReturnToSummary(true); go(key); }} />
          </>}
        </div>
        {isSphereStep(step) && <QuestionPreview proposals={stepProposals} preferences={zoned} note={ONBOARDING_QUESTIONS[step].note}
          active={active[step] ?? sphere?.choices.at(-1)?.option ?? null}
          answered={[{ label: "Важные сферы", value: String(answers.domains.length) },
            ...steps.slice(1, index).filter(isSphereStep).map((key) => {
              const count = proposals.filter((proposal) => proposal.domainKey === key && proposal.source !== "extra").length;
              return { label: labels[key], value: answers.spheres[key]?.skipped || count === 0 ? "пропущено" : `${count} ${plural(count, GOAL_FORMS)}` };
            })]}
          remaining={steps.slice(index + 1, -1).map((key) => key === "rhythm" ? "Ритм" : labels[key as DomainKey])} />}
        {step === "rhythm" && <RhythmPreview proposals={selected} />}
        {step === "summary" && <SummaryAside answers={answers} timeZone={timeZone} selected={summaryCount} />}
      </div>}
    </main>
    {/* Sticky at the bottom of the column: on screen while the step scrolls, at the end of a full-page capture. */}
    <footer className="sticky bottom-0 z-10 isolate border-t bg-background before:absolute before:inset-0 before:-z-10 before:bg-card/45">
      <div className="mx-auto flex w-full max-w-[calc(1180px+2rem)] items-center gap-2.5 px-4 pt-3 pb-[22px] md:h-[72px] md:max-w-[calc(1180px+3rem)] md:px-6 md:py-0">
        <button type="button" onClick={back} disabled={index <= 0} className={cn(ghost, "hidden md:inline-flex")}><ArrowLeft aria-hidden="true" className="size-4" />Назад</button>
        {(isSphereStep(step) || step === "rhythm") && <button type="button" onClick={skip} className={ghost}>
          <span className="md:hidden">Пропустить</span><span className="hidden md:inline">Пропустить вопрос</span></button>}
        <p className="ml-auto hidden text-xs leading-5 text-muted-foreground md:block" aria-live="polite">{hint}</p>
        <button type="button" onClick={next} disabled={step === "summary" && (summaryCount === 0 || creating)}
          className="action-link action-compact flex-1 py-[11px] disabled:cursor-not-allowed disabled:opacity-50 md:ml-auto md:flex-none md:px-[18px] md:py-[9px]">
          {nextLabel}{step !== "summary" && <ArrowRight aria-hidden="true" className="size-4" />}</button>
      </div>
    </footer>
    {editing && editingChoice && <EditChoiceDialog answers={answers} domainKey={editing.domainKey} choice={editingChoice} preferences={preferences} timeZone={timeZone}
      label={labels[editing.domainKey]} close={() => setEditing(null)}
      save={(choice) => {
        const current = answers.spheres[editing.domainKey] ?? EMPTY_SPHERE;
        setSphere(editing.domainKey, { ...current, skipped: false, choices: current.choices.map((candidate) => candidate.option === choice.option ? choice : candidate) });
        setFailedKey(null); setEditing(null);
      }} />}
    {addingExtra && <ExtraGoalDialog domains={otherDomains} preferences={zoned} close={() => setAddingExtra(false)}
      add={(goal) => { setAnswers((current) => ({ ...current, extra: [...current.extra, goal] })); setAddingExtra(false); }} />}
  </div>;
}

/** Step scale built from the chosen spheres (mockups 24–27); bars only on a phone (mockup 29). */
function Stepper({ steps, index, labels, answers }: { steps: OnboardingStep[]; index: number; labels: SphereLabels; answers: OnboardingAnswers }) {
  const label = (step: OnboardingStep) => step === "domains" ? "Сферы" : step === "rhythm" ? "Ритм" : step === "summary" ? "Итог" : labels[step];
  const current = steps[index]!;
  return <nav aria-label="Шаги настройки" className="grid gap-1.5">
    <p className="hidden items-center gap-1.5 text-xs leading-5 md:flex">
      <span className="font-semibold">{index === 0 ? "Шаг 1" : `Шаг ${index + 1} из ${steps.length}`}</span>
      <span className="text-text-3">· {index === 0 ? "дальше по одному вопросу на каждую выбранную сферу, ритм и итог" : label(current)}</span>
    </p>
    <ol className="flex gap-1 md:gap-1.5">
      {steps.map((step, at) => {
        const done = at < index;
        const skipped = done && isSphereStep(step) && (answers.spheres[step]?.skipped ?? true);
        return <li key={step} aria-current={at === index ? "step" : undefined}
          className={cn("flex min-w-0 flex-1 flex-col gap-1.5 text-[11px] leading-4 whitespace-nowrap", at === index ? "font-semibold text-foreground" : done ? "text-muted-foreground" : "text-text-3")}>
          <i aria-hidden="true" className={cn("block h-1 rounded-full", at === index ? "bg-primary" : done ? "bg-primary/75" : "bg-surface-3")} />
          <span className="max-md:sr-only truncate">{label(step)}{skipped ? " — пропущено" : done ? <><span className="sr-only"> — готово</span><Check aria-hidden="true" className="ml-1 inline size-3" /></> : null}</span>
        </li>;
      })}
    </ol>
  </nav>;
}
