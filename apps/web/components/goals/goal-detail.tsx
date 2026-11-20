"use client";

import { useCallback, useId, useRef, useState } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { activityFeedSchema, goalDeletionSchema, goalDetailsSchema, goalMeasurementDeletionSchema, measurementsPageSchema } from "@lifeos/contracts";
import type { GoalDetails, GoalMeasurement, MeasurementsPage, UserPreferences } from "@lifeos/contracts";
import { describeActivity } from "../../lib/activity-presentation.ts";
import { daysUntil, formatDaysLeft } from "../../lib/dashboard-presentation.ts";
import { getGoalsData, GoalRequestError } from "../../lib/goals-api-client.ts";
import { domainPresentation } from "../../lib/domain-presentation.ts";
import { formatGoalNumber, formatGoalPercent, formatGoalValue, goalUnitLabel, remainingToTarget } from "../../lib/goal-presentation.ts";
import { useDismiss } from "../../lib/use-dismiss.ts";
import { formatDate, formatDateTime, formatShortDateTime } from "../../lib/user-preferences.ts";
import { FormAlert } from "../auth/form-parts.tsx";
import { DomainIcon } from "../ui/domain-icon.tsx";
import { ProgressBar } from "../ui/progress-bar.tsx";
import { SectionCard } from "../ui/section-card.tsx";
import { SourceLabel } from "../ui/source-label.tsx";
import { StatCard } from "../ui/stat-card.tsx";
import { StatusChip } from "../ui/status-chip.tsx";
import { GoalForm } from "./goal-form.tsx";
import { MeasurementForm } from "./measurement-form.tsx";
import { LoadState, Modal, MutationError, StatusBadge, useGoalData, useGoalMutation } from "./shared.tsx";
import type { DomainChoice } from "./shared.tsx";

type DialogState = { mode: "goal" | "add" | "archive" | "deleteGoal" } | { mode: "edit" | "delete"; row: GoalMeasurement };
const MEASUREMENTS_TITLE = "measurements-title";
const HISTORY_LIMIT = 10;
/** Round icon button from mockup 09 (✎, ⋯), named for assistive technology, 44px on touch screens. */
const iconButton = "inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-muted-foreground transition-colors duration-[120ms] hover:border-border-strong hover:bg-surface-3 hover:text-foreground pointer-coarse:size-11";
const menuItem = "flex min-h-11 w-full items-center rounded-[10px] px-3 text-left text-sm transition-colors duration-[120ms] hover:bg-surface-3 pointer-fine:min-h-9";

/**
 * Mockup 09, top of the goal panel: big percentage (or «Недостаточно данных»), bar, the tiles Старт / Сейчас / Цель /
 * Осталось and the formula with its source. «Осталось» is exact (decimal strings) and counts calendar days to the deadline.
 */
export function GoalProgressPanel({ value, preferences, now = new Date() }: { value: GoalDetails; preferences: UserPreferences; now?: Date }) {
  const { goal, progress } = value;
  const number = (amount: string) => formatGoalNumber(amount, preferences.locale);
  const formatted = (amount: string) => formatGoalValue(amount, goal, preferences.locale);
  const daysLeft = goal.due_at ? formatDaysLeft(daysUntil(goal.due_at, now, preferences.timezone)) : "срок не задан";
  return <div className="grid gap-3.5">
    {progress.current === null
      ? <div><p className="text-xl leading-7 font-bold">Недостаточно данных</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">Добавьте первое измерение. Начальное значение само по себе не подтверждает прогресс.</p></div>
      : <div className="flex flex-wrap items-end gap-x-2.5 gap-y-1">
        <span className="text-[30px] leading-[34px] font-extrabold tabular-nums" data-testid="goal-percent">{progress.progressPercent === null ? "—" : formatGoalPercent(progress.progressPercent, preferences)}</span>
        <span className="pb-1 text-xs leading-5 text-muted-foreground wrap-anywhere tabular-nums" data-testid="goal-values">{formatted(progress.current)} из {formatted(goal.target)}</span>
      </div>}
    {progress.progressPercent !== null && <ProgressBar value={progress.progressPercent} tone={domainPresentation[goal.domain_key].tone} size="md" label="Прогресс к цели" />}
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <StatCard label="Старт" value={number(goal.baseline)} hint={formatDate(new Date(goal.created_at), preferences)} />
      <StatCard label="Сейчас" value={progress.current === null ? "—" : number(progress.current)}
        hint={progress.provenance ? <time dateTime={progress.provenance.measuredAt}>{formatDate(new Date(progress.provenance.measuredAt), preferences)}</time> : "нет измерений"} />
      <StatCard label="Цель" value={number(goal.target)} hint={goalUnitLabel(goal)} />
      <StatCard label="Осталось" value={progress.current === null ? "—" : number(remainingToTarget(goal, progress.current))} hint={daysLeft} />
    </div>
    <p className="rounded-[10px] border bg-surface-2 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
      {goal.direction === "increase" ? "Прогресс = (сейчас − старт) / (цель − старт)." : "Прогресс = (старт − сейчас) / (старт − цель)."} Источник: <strong className="font-semibold text-foreground">ручной ввод</strong>, самоотчёт. Автоматической синхронизации нет.
    </p>
    {goal.description && <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-6 text-muted-foreground">{goal.description}</p>}
  </div>;
}

/** «⋯» from mockup 09: a disclosure with the goal commands; choosing one returns focus to the toggle before the dialog opens. */
function GoalActions({ edit, archive, deleteGoal, active, disabled }: { edit(): void; archive(): void; deleteGoal(): void; active: boolean; disabled: boolean }) {
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
    <div id={id} hidden={!open} className="absolute top-full right-0 z-30 mt-1.5 grid w-48 gap-0.5 rounded-[14px] border bg-card p-1.5 shadow-popover">
      {active && <><button type="button" className={menuItem} onClick={() => choose(edit)}>Изменить цель</button>
        <button type="button" className={menuItem} onClick={() => choose(archive)}>В архив</button></>}
      <button type="button" className={`${menuItem} text-destructive`} onClick={() => choose(deleteGoal)}>Удалить цель</button>
    </div>
  </div>;
}

/**
 * Goal panel of mockup 09: next to the list on /goals from 1024px and the whole page /goals/[id] on narrow screens.
 * Header with chips and «⋯», progress, measurements and the goal's own journal («История изменений»).
 */
export function GoalPanel({ id, preferences, domains, onChanged, onDeleted }: { id: string; preferences: UserPreferences; domains: DomainChoice[]; onChanged?(): void; onDeleted(): void }) {
  const detail = useGoalData(`/api/v1/goals/${id}`, goalDetailsSchema);
  const history = useGoalData(`/api/v1/goals/${id}/measurements?limit=20`, measurementsPageSchema);
  const journal = useGoalData(`/api/v1/activity?goal_id=${id}&limit=${HISTORY_LIMIT}`, activityFeedSchema);
  const action = useGoalMutation();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [more, setMore] = useState<MeasurementsPage | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
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
  const value = detail.data;
  if (!value || detail.error) return <SectionCard titleId="goal-panel-title" title="Цель и измерения"><LoadState loading={detail.loading} error={detail.error} retry={detail.reload} /></SectionCard>;
  const { goal } = value;
  const active = goal.status === "active";
  const domainLabel = domains.find((domain) => domain.key === goal.domain_key)?.label;
  return <SectionCard titleId="goal-panel-title" title={goal.title} icon={<DomainIcon domain={goal.domain_key} />} aria-busy={detail.loading}
    className="[&_[data-slot=card-title]]:text-[17px] [&_[data-slot=card-title]]:leading-6"
    description={<span className="mt-1 flex flex-wrap items-center gap-1.5">
      {domainLabel && <StatusChip tone={domainPresentation[goal.domain_key].tone}>{domainLabel}</StatusChip>}
      <StatusChip>{goal.direction === "increase" ? "увеличить ↑" : "уменьшить ↓"}</StatusChip>
      {goal.due_at && <StatusChip tone="outline">до <time dateTime={goal.due_at}>{formatDate(new Date(goal.due_at), preferences)}</time></StatusChip>}
      <StatusBadge status={goal.status} />
    </span>}
    action={<GoalActions active={active} disabled={detail.loading} edit={() => open({ mode: "goal" })} archive={() => open({ mode: "archive" })} deleteGoal={() => open({ mode: "deleteGoal" })} />}
    contentClassName="grid gap-4">
    {message && <div role="status" className="rounded-[10px] border border-st-green/40 bg-st-green/10 px-3 py-2.5 text-sm">{message}</div>}
    {!active && <p className="rounded-[10px] border bg-surface-2 px-3 py-2.5 text-sm leading-6">Цель в архиве. Измерения и история сохранены и доступны для просмотра. Редактирование закрыто; цель можно удалить навсегда.</p>}
    <GoalProgressPanel value={value} preferences={preferences} />
    <section aria-labelledby={MEASUREMENTS_TITLE} className="grid gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={MEASUREMENTS_TITLE} tabIndex={-1} className="rounded text-sm font-bold">Измерения</h3>
        <span className="text-xs text-muted-foreground tabular-nums">{value.progress.measurementCount} · сначала последние по дате</span>
        {active && <button onClick={() => open({ mode: "add" })} disabled={detail.loading} aria-label="Добавить измерение" className="action-link action-sm ml-auto disabled:opacity-50"><Plus aria-hidden="true" className="size-3.5" />Измерение</button>}
      </div>
      <LoadState loading={history.loading} error={history.error} retry={history.reload} />
      {records && !history.loading && !history.error && <>
        {!records.items.length ? <p className="rounded-[10px] border border-dashed border-border-strong p-4 text-sm leading-6 text-muted-foreground">Измерений пока нет. Добавьте первое значение, чтобы увидеть прогресс.</p>
          : <ol className="grid">{records.items.map((row) => <li key={row.id} className="min-w-0 border-b py-2 first:pt-0 last:border-b-0 last:pb-0" data-testid="measurement-row">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <time dateTime={row.measured_at} title={formatDateTime(new Date(row.measured_at), preferences)} className="text-xs text-muted-foreground tabular-nums">{formatShortDateTime(new Date(row.measured_at), preferences)}</time>
              <span className="text-sm font-semibold wrap-anywhere tabular-nums">{formatGoalValue(row.value, goal, preferences.locale)}</span>
              <SourceLabel>ручной ввод{row.updated_at !== row.created_at && " · исправлено"}</SourceLabel>
              {active && <span className="ml-auto flex gap-1"><button onClick={() => open({ mode: "edit", row })} aria-label="Изменить" title="Изменить измерение" className={iconButton}><Pencil aria-hidden="true" className="size-3.5" /></button>
                <button onClick={() => open({ mode: "delete", row })} aria-label="Удалить" title="Удалить измерение" className={`${iconButton} hover:text-destructive`}><Trash2 aria-hidden="true" className="size-3.5" /></button></span>}
            </div>
            {row.note && <p className="mt-1 whitespace-pre-wrap wrap-anywhere text-xs leading-5 text-muted-foreground">{row.note}</p>}</li>)}</ol>}
        {moreError && <FormAlert tone="error">{moreError}</FormAlert>}
        {records.nextCursor && <div><button onClick={loadMore} disabled={moreLoading} className="action-link-secondary action-compact disabled:opacity-50">{moreLoading ? "Загружаем…" : "Показать ещё измерения"}</button></div>}
      </>}
    </section>
    <section aria-labelledby="goal-history-title" className="grid gap-2">
      <div className="flex items-center gap-2"><h3 id="goal-history-title" className="text-sm font-bold">История изменений</h3><SourceLabel className="ml-auto">журнал действий</SourceLabel></div>
      <LoadState loading={journal.loading} error={journal.error} retry={journal.reload} />
      {journal.data && !journal.loading && !journal.error && <ol className="grid gap-1 text-xs leading-5 text-muted-foreground" data-testid="goal-history">
        {journal.data.items.map((entry) => <li key={entry.id} className="min-w-0 wrap-anywhere">
          <time dateTime={entry.occurredAt} title={formatDateTime(new Date(entry.occurredAt), preferences)} className="tabular-nums">{formatShortDateTime(new Date(entry.occurredAt), preferences)}</time> · {describeActivity(entry, preferences)}
        </li>)}
      </ol>}
    </section>
    {dialog && <Modal title={dialog.mode === "goal" ? "Изменить цель" : dialog.mode === "add" ? "Новое измерение" : dialog.mode === "edit" ? "Исправить измерение" : dialog.mode === "delete" ? "Удалить измерение?" : dialog.mode === "deleteGoal" ? "Удалить цель?" : "Архивировать цель?"}
      role={dialog.mode === "deleteGoal" ? "alertdialog" : "dialog"} describedBy={dialog.mode === "deleteGoal" ? "delete-goal-description" : undefined}
      busy={dialogBusy || action.pending || action.uncertain} close={() => setDialog(null)}>
      {dialog.mode === "deleteGoal" && <div className="grid gap-5"><MutationError error={action.error} uncertain={action.uncertain} />
        <p id="delete-goal-description" className="text-sm leading-7">Измерения и история тоже удалятся. Это нельзя отменить.</p>
        <div className="flex flex-wrap justify-end gap-2.5">
          <button data-dialog-initial-focus disabled={action.pending || action.uncertain} className="action-link-secondary action-compact disabled:opacity-50" onClick={() => setDialog(null)}>Отмена</button>
          <button disabled={action.pending} className="action-link-secondary action-compact border-destructive/55 text-destructive hover:bg-destructive/10 disabled:opacity-50"
            onClick={() => void action.save({ url: `/api/v1/goals/${id}`, method: "DELETE" }, goalDeletionSchema, onDeleted)}>
            {action.pending ? "Удаляем…" : action.uncertain ? "Повторить запрос" : "Удалить"}</button>
        </div></div>}
      {dialog.mode === "goal" && <GoalForm initial={goal} definitionEditable={value.progress.measurementCount === 0} domains={domains} preferences={preferences} onBusyChange={setDialogBusy} saved={() => saved("Изменения цели сохранены.")}
        cancel={<button type="button" disabled={dialogBusy} onClick={() => setDialog(null)} className="action-link-secondary action-compact disabled:opacity-50">Отмена</button>} />}
      {(dialog.mode === "add" || dialog.mode === "edit") && <MeasurementForm goal={goal} initial={dialog.mode === "edit" ? dialog.row : undefined} preferences={preferences} onBusyChange={setDialogBusy} saved={() => saved(dialog.mode === "add" ? "Измерение добавлено." : "Измерение исправлено.")} />}
      {(dialog.mode === "delete" || dialog.mode === "archive") && <div className="grid gap-5"><MutationError error={action.error} uncertain={action.uncertain} />
        <p className="text-sm leading-7">{dialog.mode === "delete" ? <>Будет удалено измерение <strong>{formatGoalValue(dialog.row.value, goal, preferences.locale)}</strong> от {formatDateTime(new Date(dialog.row.measured_at), preferences)}. Прогресс обновится, а факт удаления останется в журнале.</>
          : "Цель и её измерения сохранятся в архиве. Добавление, исправление и удаление измерений будут закрыты. Вернуть цель в активные в этом этапе нельзя."}</p>
        <div className="flex flex-wrap justify-end gap-2.5"><button autoFocus disabled={action.pending || action.uncertain} className="action-link-secondary action-compact disabled:opacity-50" onClick={() => setDialog(null)}>Отмена</button>
          <button disabled={action.pending} className="action-link action-compact disabled:opacity-50" onClick={() => {
            if (dialog.mode === "delete") void action.save({ url: `/api/v1/goal-measurements/${dialog.row.id}`, method: "DELETE" }, goalMeasurementDeletionSchema, () => saved("Измерение удалено. Прогресс обновлён."));
            else void action.save({ url: `/api/v1/goals/${id}`, method: "PATCH", body: { status: "archived" } }, goalDetailsSchema, () => saved("Цель перенесена в архив. История сохранена."));
          }}>{action.pending ? "Сохраняем…" : action.uncertain ? "Повторить запрос" : dialog.mode === "delete" ? "Подтвердить удаление" : "Подтвердить архивирование"}</button></div></div>}
    </Modal>}
  </SectionCard>;
}
