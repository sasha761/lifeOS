"use client";

import { useCallback, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { activityFeedSchema, GOAL_PHASE_LABELS, goalDeletionSchema, goalDetailsSchema, goalMeasurementDeletionSchema, measurementsPageSchema } from "@lifeos/contracts";
import type { Goal, GoalDetails, GoalMeasurement, GoalPhase, MeasurementsPage, UserPreferences } from "@lifeos/contracts";
import { describeActivity } from "../../lib/activity-presentation.ts";
import { daysUntil, formatDaysLeft } from "../../lib/dashboard-presentation.ts";
import { getGoalsData, GoalRequestError } from "../../lib/goals-api-client.ts";
import { domainPresentation } from "../../lib/domain-presentation.ts";
import { formatGoalPercent, formatGoalValue, phaseLabel, remainingToTarget } from "../../lib/goal-presentation.ts";
import { useDismiss } from "../../lib/use-dismiss.ts";
import { formatDate, formatDateTime, formatShortDateTime } from "../../lib/user-preferences.ts";
import { FormAlert } from "../auth/form-parts.tsx";
import { DomainIcon } from "../ui/domain-icon.tsx";
import { ProgressBar } from "../ui/progress-bar.tsx";
import { SectionCard } from "../ui/section-card.tsx";
import { SourceLabel } from "../ui/source-label.tsx";
import { GoalForm } from "./goal-form.tsx";
import { MeasurementForm } from "./measurement-form.tsx";
import { ExampleChip, GoalStatusChip, LoadState, Modal, MutationError, useGoalData, useGoalMutation } from "./shared.tsx";
import type { DomainChoice } from "./shared.tsx";

type DialogState = { mode: "goal" | "add" | "archive" | "deleteGoal" } | { mode: "edit" | "delete"; row: GoalMeasurement };
const MEASUREMENTS_TITLE = "measurements-title";
const HISTORY_LIMIT = 10;
/** Round icon button from mockup 09 (✎, ⋯), named for assistive technology, 44px on touch screens. */
const iconButton = "inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-muted-foreground transition-colors duration-[120ms] hover:border-border-strong hover:bg-surface-3 hover:text-foreground pointer-coarse:size-11";
const menuItem = "flex min-h-11 w-full items-center rounded-[10px] px-3 text-left text-sm transition-colors duration-[120ms] hover:bg-surface-3 pointer-fine:min-h-9";

/** «220 дней до срока» (mockup 32): calendar days to the deadline in the account's zone. */
function deadlineText(dueAt: string | null, now: Date, timeZone: string): string {
  if (!dueAt) return "срок не задан";
  const days = daysUntil(dueAt, now, timeZone);
  if (days < 0) return "срок прошёл";
  return days === 0 ? "срок сегодня" : `${formatDaysLeft(days)} до срока`;
}

/**
 * Mockup 32, top of the goal panel: big percentage (or «Недостаточно данных») with «X из Y», bar and
 * «Осталось N · M дней до срока». «Осталось» is exact (decimal strings); the start and the formula are in «Как считается».
 */
export function GoalProgressPanel({ value, preferences, now = new Date() }: { value: GoalDetails; preferences: UserPreferences; now?: Date }) {
  const { goal, progress } = value;
  if (goal.kind !== "numeric") return null;
  const formatted = (amount: string) => formatGoalValue(amount, goal, preferences.locale);
  return <div className="grid gap-3.5">
    {progress.current === null
      ? <div><p className="text-xl leading-7 font-bold">Недостаточно данных</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">Добавьте первое измерение. Начальное значение само по себе не подтверждает прогресс.</p></div>
      : <div className="flex flex-wrap items-end gap-x-2.5 gap-y-1">
        <span className="text-[30px] leading-[34px] font-extrabold tabular-nums" data-testid="goal-percent">{progress.progressPercent === null ? "—" : formatGoalPercent(progress.progressPercent, preferences)}</span>
        <span className="pb-1 text-xs leading-5 text-muted-foreground wrap-anywhere tabular-nums" data-testid="goal-values">{formatted(progress.current)} из {formatted(goal.target)}</span>
      </div>}
    {progress.progressPercent !== null && <ProgressBar value={progress.progressPercent} tone={domainPresentation[goal.domain_key].tone} size="md" label="Прогресс к цели" />}
    <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-xs leading-5">
      {progress.current !== null && <><span className="text-muted-foreground">Осталось</span>
        <strong className="font-bold wrap-anywhere tabular-nums" data-testid="goal-remaining">{formatted(remainingToTarget(goal, progress.current))}</strong></>}
      <span className="ml-auto text-muted-foreground tabular-nums">{deadlineText(goal.due_at, now, preferences.timezone)}</span>
    </p>
  </div>;
}

/** Large phase words of a goal without measurements (mockup 36, `.state` 26/32 · 800). */
const PHASE_TEXT = { planned: "text-foreground", in_progress: "text-st-amber", paused: "text-st-blue", achieved: "text-st-green" } as const;

/**
 * Top of the panel of a goal without measurements (LFS-225): mockup 36 for «В процессе», the owner's description for
 * «Достигнута» — its phase in large letters instead of a percentage, since when (or when it was marked) and why there is
 * no percentage.
 */
export function PhaseState({ goal, preferences, now = new Date() }: { goal: Goal; preferences: UserPreferences; now?: Date }) {
  const day = (instant: string) => <time dateTime={instant}>{formatDate(new Date(instant), preferences)}</time>;
  const since = goal.phase === "paused" ? <>на паузе с {day(goal.phase_changed_at)}</> : goal.starts_at ? <>с {day(goal.starts_at)}</> : null;
  return <div className="grid gap-3.5" data-testid="goal-phase">
    <div className="grid gap-1">
      <p className={`text-[26px] leading-8 font-extrabold tracking-[-0.01em] ${PHASE_TEXT[goal.phase]}`}>{phaseLabel(goal.phase)}</p>
      {goal.phase === "achieved"
        ? <p className="flex flex-wrap items-baseline gap-x-2.5 text-xs leading-5 text-muted-foreground tabular-nums">
          <span>отмечена {day(goal.phase_changed_at)}</span><SourceLabel>ручная отметка</SourceLabel></p>
        : <p className="text-xs leading-5 text-muted-foreground tabular-nums">{since}{since && " · "}{deadlineText(goal.due_at, now, preferences.timezone)}</p>}
    </div>
    <p className="text-xs leading-5 text-muted-foreground">{goal.phase === "achieved"
      ? "Цель снова станет «В процессе», если вернуть её в работу. Отметка останется в истории."
      : "Процента нет. Когда цель будет достигнута, отметьте её сами."}</p>
  </div>;
}

/**
 * «Как считается» (mockup 32): the start with its date, the target, the formula and the source of the numbers; for a goal
 * without measurements, why there is no percentage and who sets its status (LFS-225).
 */
function GoalFormula({ value, preferences }: { value: GoalDetails; preferences: UserPreferences }) {
  const { goal, progress } = value;
  if (goal.kind !== "numeric") return <div className="grid gap-1 rounded-[10px] border bg-surface-2 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
    <p>Процента нет: у этой цели нет чисел и измерений. Статус ставите вы сами — кнопкой или в меню «⋯».</p>
    <p>Система статус не меняет и не отмечает цель достигнутой сама. Каждая смена статуса остаётся в истории изменений.</p>
  </div>;
  const formatted = (amount: string) => formatGoalValue(amount, goal, preferences.locale);
  return <div className="grid gap-1 rounded-[10px] border bg-surface-2 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
    <p className="tabular-nums">Старт <strong className="font-semibold text-foreground">{formatted(goal.baseline)}</strong> (<time dateTime={goal.created_at}>{formatDate(new Date(goal.created_at), preferences)}</time>),
      цель <strong className="font-semibold text-foreground">{formatted(goal.target)}</strong>.</p>
    <p>{goal.direction === "increase" ? "Прогресс = (сейчас − старт) / (цель − старт)." : "Прогресс = (старт − сейчас) / (старт − цель)."} Источник: {progress.provenance?.kind === "example"
      ? <><strong className="font-semibold text-foreground">пример</strong> из стартового набора, не ваши данные.</>
      : <><strong className="font-semibold text-foreground">ручной ввод</strong>, самоотчёт.</>} Автоматической синхронизации нет.</p>
  </div>;
}

/**
 * «Удалить цель?» (LFS-216): one confirmation for «⋯ → Удалить цель» in the panel and «Удалить» on a list row (LFS-224).
 * The native dialog returns focus to the button that opened it when it is cancelled.
 */
export function DeleteGoalDialog({ id, close, onDeleted }: { id: string; close(): void; onDeleted(): void }) {
  const action = useGoalMutation();
  return <Modal title="Удалить цель?" role="alertdialog" describedBy="delete-goal-description" busy={action.pending || action.uncertain} close={close}>
    <div className="grid gap-5"><MutationError error={action.error} uncertain={action.uncertain} />
      <p id="delete-goal-description" className="text-sm leading-7">Измерения и история тоже удалятся. Это нельзя отменить.</p>
      <div className="flex flex-wrap justify-end gap-2.5">
        <button data-dialog-initial-focus disabled={action.pending || action.uncertain} className="action-link-secondary action-compact disabled:opacity-50" onClick={close}>Отмена</button>
        <button disabled={action.pending} className="action-link-secondary action-compact border-destructive/55 text-destructive hover:bg-destructive/10 disabled:opacity-50"
          onClick={() => void action.save({ url: `/api/v1/goals/${id}`, method: "DELETE" }, goalDeletionSchema, onDeleted)}>
          {action.pending ? "Удаляем…" : action.uncertain ? "Повторить запрос" : "Удалить"}</button>
      </div></div>
  </Modal>;
}

/** «Как считается ›», «История изменений · N ›» (mockup 32): a toggle for a section of the panel below it. */
function Disclosure({ open, controls, onToggle, className, children }: { open: boolean; controls: string; onToggle(): void; className?: string; children: ReactNode }) {
  return <button type="button" aria-expanded={open} aria-controls={controls} onClick={onToggle}
    className={`inline-flex min-h-11 items-center gap-1 rounded text-xs text-muted-foreground transition-colors duration-[120ms] hover:text-foreground pointer-fine:min-h-6 ${className ?? ""}`}>
    {children}<ChevronRight aria-hidden="true" className={`size-3.5 transition-transform duration-[180ms] ${open ? "rotate-90" : ""}`} /></button>;
}

const Divider = () => <div aria-hidden="true" className="h-px bg-border" />;

/** «Начать», «Продолжить», «Вернуть в работу» all lead to «В процессе»; the word depends on where the goal is. */
const TO_IN_PROGRESS: Record<GoalPhase, string> = { planned: "Начать", in_progress: "", paused: "Продолжить", achieved: "Вернуть в работу" };

/** Every other phase from the current one (LFS-225): a manual command for any pair, and the same moves the board makes (LFS-229). */
function phaseMoves(from: GoalPhase): { to: GoalPhase; label: string }[] {
  const moves: { to: GoalPhase; label: string }[] = [
    { to: "in_progress", label: TO_IN_PROGRESS[from] }, { to: "paused", label: "Поставить на паузу" },
    { to: "achieved", label: "Отметить достигнутой" }, { to: "planned", label: "Перенести в запланированные" },
  ];
  return moves.filter((move) => move.to !== from);
}

/**
 * «⋯» from mockup 09: a disclosure with the goal commands — the phase moves (LFS-225), then edit, archive and delete. Choosing
 * one returns focus to the toggle before a dialog opens or the phase changes.
 */
function GoalActions({ edit, archive, deleteGoal, setPhase, phase, active, disabled }: { edit(): void; archive(): void; deleteGoal(): void; setPhase(phase: GoalPhase): void; phase: GoalPhase; active: boolean; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, box, toggle);
  const choose = (action: () => void) => { setOpen(false); toggle.current?.focus(); action(); };
  return <div ref={box} className="relative">
    <button ref={toggle} type="button" aria-label="Действия с целью" aria-expanded={open} aria-controls={id} disabled={disabled}
      onClick={() => setOpen((value) => !value)} className={`${iconButton} size-8 disabled:opacity-50`}><MoreHorizontal aria-hidden="true" className="size-4" /></button>
    <div id={id} hidden={!open} className="absolute top-full right-0 z-30 mt-1.5 grid w-64 gap-0.5 rounded-[14px] border bg-card p-1.5 shadow-popover">
      {active && <>{phaseMoves(phase).map((move) => <button key={move.to} type="button" className={menuItem} onClick={() => choose(() => setPhase(move.to))}>{move.label}</button>)}
        <div aria-hidden="true" className="mx-1.5 my-1 h-px bg-border" />
        <button type="button" className={menuItem} onClick={() => choose(edit)}>Изменить цель</button>
        <button type="button" className={menuItem} onClick={() => choose(archive)}>В архив</button></>}
      <button type="button" className={`${menuItem} text-destructive`} onClick={() => choose(deleteGoal)}>Удалить цель</button>
    </div>
  </div>;
}

/**
 * Goal panel of mockup 32: next to the list on /goals from 1024px and the whole page /goals/[id] on narrow screens.
 * Header with «сфера · вид · срок» and «⋯», progress, one main button, measurements; «Как считается» and the goal's own
 * journal («История изменений») open below on demand.
 */
export function GoalPanel({ id, preferences, domains, onChanged, onDeleted }: { id: string; preferences: UserPreferences; domains: DomainChoice[]; onChanged?(): void; onDeleted(): void }) {
  const detail = useGoalData(`/api/v1/goals/${id}`, goalDetailsSchema);
  const history = useGoalData(`/api/v1/goals/${id}/measurements?limit=20`, measurementsPageSchema);
  // One entry more than shown tells whether to write «10+» (the feed has no total).
  const journal = useGoalData(`/api/v1/activity?goal_id=${id}&limit=${HISTORY_LIMIT + 1}`, activityFeedSchema);
  const action = useGoalMutation();
  // A phase change (LFS-225) has no dialog: its own mutation, error and retry live in the panel.
  const phaseAction = useGoalMutation();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [more, setMore] = useState<MeasurementsPage | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [shown, setShown] = useState({ formula: false, history: false });
  const records = more ?? history.data;
  function saved(message: string) {
    setDialog(null); setDialogBusy(false); setMessage(message); setMore(null); setMoreError(null);
    detail.reload(); history.reload(); journal.reload(); onChanged?.();
    setTimeout(() => document.getElementById(MEASUREMENTS_TITLE)?.focus(), 0);
  }
  async function loadMore() {
    if (!records?.nextCursor || moreLoading) return;
    setMoreLoading(true); setMoreError(null);
    try {
      const next = await getGoalsData(`/api/v1/goals/${id}/measurements?limit=20&cursor=${encodeURIComponent(records.nextCursor)}`, measurementsPageSchema);
      setMore({ ...next, items: [...new Map([...records.items, ...next.items].map((row) => [row.id, row])).values()] });
    } catch (error) { setMoreError(error instanceof GoalRequestError ? error.message : "Не удалось загрузить историю."); }
    finally { setMoreLoading(false); }
  }
  function open(value: DialogState) { setDialogBusy(false); setDialog(value); }
  function changePhase(phase: GoalPhase) {
    void phaseAction.save({ url: `/api/v1/goals/${id}`, method: "PATCH", body: { phase } }, goalDetailsSchema, () => {
      setMessage(`Статус цели: «${GOAL_PHASE_LABELS[phase]}».`);
      detail.reload(); journal.reload(); onChanged?.();
    });
  }
  const value = detail.data;
  if (!value || detail.error) return <SectionCard titleId="goal-panel-title" title="Цель и измерения"><LoadState loading={detail.loading} error={detail.error} retry={detail.reload} /></SectionCard>;
  const { goal } = value;
  const active = goal.status === "active";
  const domainLabel = domains.find((domain) => domain.key === goal.domain_key)?.label;
  // LFS-218: the measurements are either all examples or all the person's own — the first own value removes the examples.
  const onlyExamples = value.progress.provenance?.kind === "example";
  const entries = journal.data && !journal.loading && !journal.error ? journal.data.items : null;
  const day = (instant: string) => <time dateTime={instant}>{formatDate(new Date(instant), preferences)}</time>;
  const kind = goal.kind === "numeric" ? goal.direction === "increase" ? "увеличить ↑" : "уменьшить ↓" : "без измерений";
  return <SectionCard titleId="goal-panel-title" title={goal.title} icon={<DomainIcon domain={goal.domain_key} />} aria-busy={detail.loading}
    titleAddon={<><GoalStatusChip goal={goal} />{goal.origin === "starter" && <ExampleChip />}</>}
    description={<span className="block pl-[38px] tabular-nums" data-testid="goal-meta">{domainLabel && <>{domainLabel} · </>}{kind}
      {/* The start of a goal without measurements is in its status block (mockup 36). */}
      {goal.kind === "numeric" && goal.starts_at && <> · с {day(goal.starts_at)}</>}{goal.due_at && <> · до {day(goal.due_at)}</>}</span>}
    action={<GoalActions active={active} phase={goal.phase} disabled={detail.loading} setPhase={changePhase} edit={() => open({ mode: "goal" })} archive={() => open({ mode: "archive" })} deleteGoal={() => open({ mode: "deleteGoal" })} />}
    contentClassName="grid gap-3.5">
    {message && <div role="status" className="rounded-[10px] border border-st-green/40 bg-st-green/10 px-3 py-2.5 text-sm">{message}</div>}
    <MutationError error={phaseAction.error} uncertain={phaseAction.uncertain} />
    {!active && <p className="rounded-[10px] border bg-surface-2 px-3 py-2.5 text-sm leading-6">Цель в архиве. Измерения и история сохранены и доступны для просмотра. Редактирование закрыто; цель можно удалить навсегда.</p>}
    {active && onlyExamples && <p className="rounded-[10px] border border-st-amber/35 bg-st-amber/10 px-3 py-2.5 text-sm leading-6" data-testid="example-hint">Это пример: поправьте старт и цель под себя или удалите цель.</p>}
    {goal.kind === "numeric" ? <GoalProgressPanel value={value} preferences={preferences} /> : <PhaseState goal={goal} preferences={preferences} />}
    {active && (goal.kind === "numeric"
      ? <button onClick={() => open({ mode: "add" })} disabled={detail.loading} className="action-link w-full py-2 text-[13px] pointer-fine:min-h-[38px] disabled:opacity-50"><Plus aria-hidden="true" className="size-4" />Добавить измерение</button>
      // One element for both words: focus stays on it when the phase flips. Never disabled while saving, so it keeps focus;
      // a second click during the request is ignored by the mutation lock.
      : <button onClick={() => changePhase(goal.phase === "achieved" ? "in_progress" : "achieved")} aria-busy={phaseAction.pending}
        className={`${goal.phase === "achieved" ? "action-link-secondary" : "action-link"} w-full py-2 text-[13px] pointer-fine:min-h-[38px]`}>
        {goal.phase === "achieved" ? "↺ Вернуть в работу" : "✓ Отметить достигнутой"}</button>)}
    {goal.description && <><Divider />
      <section aria-labelledby="goal-description-title" className="grid gap-1.5"><h3 id="goal-description-title" className="field-label">Описание</h3>
        <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-6">{goal.description}</p></section></>}
    {goal.kind === "numeric" && <><Divider />
    <section aria-labelledby={MEASUREMENTS_TITLE} className="grid gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={MEASUREMENTS_TITLE} tabIndex={-1} className="rounded text-sm font-bold">Измерения</h3>
        <span className="text-xs text-muted-foreground tabular-nums">{value.progress.measurementCount}</span>
        {value.progress.provenance && <SourceLabel className="ml-auto">{onlyExamples ? "пример" : "ручной ввод"}</SourceLabel>}
      </div>
      <LoadState loading={history.loading} error={history.error} retry={history.reload} />
      {records && !history.loading && !history.error && <>
        {!records.items.length ? <p className="rounded-[10px] border border-dashed border-border-strong p-4 text-sm leading-6 text-muted-foreground">Измерений пока нет. Добавьте первое значение, чтобы увидеть прогресс.</p>
          : <ol className="grid gap-1.5">{records.items.map((row) => <li key={row.id} className="min-w-0" data-testid="measurement-row">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5">
              <time dateTime={row.measured_at} title={formatDateTime(new Date(row.measured_at), preferences)} className="min-w-[84px] text-muted-foreground tabular-nums">{formatDate(new Date(row.measured_at), preferences)}</time>
              <span className="font-semibold wrap-anywhere tabular-nums">{formatGoalValue(row.value, goal, preferences.locale)}</span>
              {row.source === "example" ? <ExampleChip /> : row.updated_at !== row.created_at && <span className="text-[11px] text-muted-foreground">исправлено</span>}
              {/* An example value is not corrected into the person's data: their own measurement replaces it (LFS-218). */}
              {active && <span className="ml-auto flex gap-1.5">{row.source !== "example" && <button onClick={() => open({ mode: "edit", row })} aria-label="Изменить" title="Изменить измерение" className={iconButton}><Pencil aria-hidden="true" className="size-3.5" /></button>}
                <button onClick={() => open({ mode: "delete", row })} aria-label="Удалить" title="Удалить измерение" className={`${iconButton} hover:text-destructive`}><Trash2 aria-hidden="true" className="size-3.5" /></button></span>}
            </div>
            {row.note && <p className="mt-1 whitespace-pre-wrap wrap-anywhere text-xs leading-5 text-muted-foreground">{row.note}</p>}</li>)}</ol>}
        {moreError && <FormAlert tone="error">{moreError}</FormAlert>}
        {records.nextCursor && <div><button onClick={loadMore} disabled={moreLoading} className="action-link-secondary action-compact disabled:opacity-50">{moreLoading ? "Загружаем…" : "Показать ещё измерения"}</button></div>}
      </>}
    </section></>}
    <Divider />
    <div className="flex flex-wrap items-center gap-x-4">
      <Disclosure open={shown.formula} controls="goal-formula" onToggle={() => setShown((value) => ({ ...value, formula: !value.formula }))}>Как считается</Disclosure>
      <Disclosure open={shown.history} controls="goal-history" className="ml-auto" onToggle={() => setShown((value) => ({ ...value, history: !value.history }))}>
        История изменений{entries && <span className="tabular-nums"> · {entries.length > HISTORY_LIMIT ? `${HISTORY_LIMIT}+` : entries.length}</span>}</Disclosure>
    </div>
    <div id="goal-formula" hidden={!shown.formula}><GoalFormula value={value} preferences={preferences} /></div>
    <section id="goal-history" aria-label="История изменений" hidden={!shown.history} className="grid gap-2">
      <SourceLabel>журнал действий</SourceLabel>
      <LoadState loading={journal.loading} error={journal.error} retry={journal.reload} />
      {entries && <ol className="grid gap-1 text-xs leading-5 text-muted-foreground" data-testid="goal-history">
        {entries.slice(0, HISTORY_LIMIT).map((entry) => <li key={entry.id} className="min-w-0 wrap-anywhere">
          <time dateTime={entry.occurredAt} title={formatDateTime(new Date(entry.occurredAt), preferences)} className="tabular-nums">{formatShortDateTime(new Date(entry.occurredAt), preferences)}</time> · {describeActivity(entry, preferences)}
          {entry.example && <> <ExampleChip /></>}
        </li>)}
      </ol>}
    </section>
    {dialog?.mode === "deleteGoal" && <DeleteGoalDialog id={id} close={() => setDialog(null)} onDeleted={onDeleted} />}
    {dialog && dialog.mode !== "deleteGoal" && <Modal title={dialog.mode === "goal" ? "Изменить цель" : dialog.mode === "add" ? "Новое измерение" : dialog.mode === "edit" ? "Исправить измерение" : dialog.mode === "delete" ? "Удалить измерение?" : "Архивировать цель?"}
      busy={dialogBusy || action.pending || action.uncertain} close={() => setDialog(null)}>
      {dialog.mode === "goal" && <GoalForm initial={goal} definitionEditable={goal.kind === "numeric" && (value.progress.measurementCount === 0 || onlyExamples)} replacesExample={onlyExamples} domains={domains} preferences={preferences} onBusyChange={setDialogBusy} saved={() => saved("Изменения цели сохранены.")}
        cancel={<button type="button" disabled={dialogBusy} onClick={() => setDialog(null)} className="action-link-secondary action-compact disabled:opacity-50">Отмена</button>} />}
      {(dialog.mode === "add" || dialog.mode === "edit") && goal.kind === "numeric" && <MeasurementForm goal={goal} initial={dialog.mode === "edit" ? dialog.row : undefined} replacesExample={dialog.mode === "add" && onlyExamples} preferences={preferences} onBusyChange={setDialogBusy} saved={() => saved(dialog.mode === "add" ? "Измерение добавлено." : "Измерение исправлено.")} />}
      {(dialog.mode === "delete" || dialog.mode === "archive") && <div className="grid gap-5"><MutationError error={action.error} uncertain={action.uncertain} />
        <p className="text-sm leading-7">{dialog.mode === "delete" ? <>Будет удалено измерение <strong>{goal.kind === "numeric" ? formatGoalValue(dialog.row.value, goal, preferences.locale) : dialog.row.value}</strong> от {formatDateTime(new Date(dialog.row.measured_at), preferences)}. Прогресс обновится, а факт удаления останется в журнале.</>
          : "Цель и её измерения сохранятся в архиве. Добавление, исправление и удаление измерений будут закрыты. Вернуть цель в активные в этом этапе нельзя."}</p>
        <div className="flex flex-wrap justify-end gap-2.5"><button autoFocus disabled={action.pending || action.uncertain} className="action-link-secondary action-compact disabled:opacity-50" onClick={() => setDialog(null)}>Отмена</button>
          <button disabled={action.pending} className="action-link action-compact disabled:opacity-50" onClick={() => {
            if (dialog.mode === "delete") void action.save({ url: `/api/v1/goal-measurements/${dialog.row.id}`, method: "DELETE" }, goalMeasurementDeletionSchema, () => saved("Измерение удалено. Прогресс обновлён."));
            else void action.save({ url: `/api/v1/goals/${id}`, method: "PATCH", body: { status: "archived" } }, goalDetailsSchema, () => saved("Цель перенесена в архив. История сохранена."));
          }}>{action.pending ? "Сохраняем…" : action.uncertain ? "Повторить запрос" : dialog.mode === "delete" ? "Подтвердить удаление" : "Подтвердить архивирование"}</button></div></div>}
    </Modal>}
  </SectionCard>;
}
