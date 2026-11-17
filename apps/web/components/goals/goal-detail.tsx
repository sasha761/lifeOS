"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { goalDetailsSchema, goalMeasurementDeletionSchema, measurementsPageSchema } from "@lifeos/contracts";
import type { GoalDetails, GoalMeasurement, MeasurementsPage, UserPreferences } from "@lifeos/contracts";
import { getGoalsData, GoalRequestError } from "../../lib/goals-api-client.ts";
import { domainPresentation } from "../../lib/domain-presentation.ts";
import { formatGoalPercent, formatGoalValue } from "../../lib/goal-presentation.ts";
import { formatDate, formatDateTime, formatShortDateTime } from "../../lib/user-preferences.ts";
import { FormAlert } from "../auth/form-parts.tsx";
import { DomainIcon } from "../ui/domain-icon.tsx";
import { PageHeader } from "../ui/page-header.tsx";
import { ProgressBar } from "../ui/progress-bar.tsx";
import { SectionCard } from "../ui/section-card.tsx";
import { SourceLabel } from "../ui/source-label.tsx";
import { StatCard } from "../ui/stat-card.tsx";
import { StatusChip } from "../ui/status-chip.tsx";
import { GoalForm } from "./goal-form.tsx";
import { MeasurementForm } from "./measurement-form.tsx";
import { LoadState, Modal, MutationError, StatusBadge, useGoalData, useGoalMutation } from "./shared.tsx";
import type { DomainChoice } from "./shared.tsx";

type DialogState = { mode: "goal" | "add" | "archive" } | { mode: "edit" | "delete"; row: GoalMeasurement };
const MEASUREMENTS_TITLE = "measurements-title";
/** Row action from mockup 09 (✎): an icon button named for assistive technology, 44px on touch screens. */
const iconButton = "inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-muted-foreground transition-colors duration-[120ms] hover:border-border-strong hover:bg-surface-3 hover:text-foreground pointer-coarse:size-11";

/** Mockup 09, goal panel: big percentage (or «Недостаточно данных»), bar, Старт/Сейчас/Цель/Измерений tiles, formula note. */
export function GoalProgressPanel({ value, preferences }: { value: GoalDetails; preferences: UserPreferences }) {
  const { goal, progress } = value;
  const formatted = (amount: string) => formatGoalValue(amount, goal, preferences.locale);
  return <SectionCard titleId="goal-progress-title" title="Прогресс">
    <div className="grid gap-3.5">
      {progress.current === null
        ? <div><p className="text-xl leading-7 font-bold">Недостаточно данных</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Добавьте первое измерение. Начальное значение само по себе не подтверждает прогресс.</p></div>
        : <div className="flex flex-wrap items-end gap-x-2.5 gap-y-1">
          <span className="text-[30px] leading-[34px] font-extrabold tabular-nums" data-testid="goal-percent">{progress.progressPercent === null ? "—" : formatGoalPercent(progress.progressPercent, preferences)}</span>
          <span className="pb-1 text-xs leading-5 text-muted-foreground wrap-anywhere tabular-nums" data-testid="goal-values">{formatted(progress.current)} из {formatted(goal.target)}</span>
        </div>}
      {progress.progressPercent !== null && <ProgressBar value={progress.progressPercent} tone={domainPresentation[goal.domain_key].tone} size="md" label="Прогресс к цели" />}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatCard label="Старт" value={formatted(goal.baseline)} hint={formatDate(new Date(goal.created_at), preferences)} />
        <StatCard label="Сейчас" value={progress.current === null ? "Нет данных" : formatted(progress.current)}
          hint={progress.provenance ? <time dateTime={progress.provenance.measuredAt}>{formatDate(new Date(progress.provenance.measuredAt), preferences)}</time> : "нет измерений"} />
        <StatCard label="Цель" value={formatted(goal.target)} hint={goal.direction === "increase" ? "увеличить ↑" : "уменьшить ↓"} />
        <StatCard label="Измерений" value={progress.measurementCount} hint={<SourceLabel>ручной ввод</SourceLabel>} />
      </div>
      <p className="rounded-[10px] border bg-surface-2 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
        Прогресс = (сейчас − старт) / (цель − старт). Источник: <strong className="font-semibold text-foreground">ручной ввод</strong>, самоотчёт. Автоматической синхронизации нет.
      </p>
      {goal.description && <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-6 text-muted-foreground">{goal.description}</p>}
      {goal.due_at && <p className="text-xs text-muted-foreground">Срок: <time dateTime={goal.due_at}>{formatDateTime(new Date(goal.due_at), preferences)}</time></p>}
    </div>
  </SectionCard>;
}

export function GoalDetail({ id, preferences, domains }: { id: string; preferences: UserPreferences; domains: DomainChoice[] }) {
  const detail = useGoalData(`/api/v1/goals/${id}`, goalDetailsSchema);
  const history = useGoalData(`/api/v1/goals/${id}/measurements?limit=20`, measurementsPageSchema);
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
    detail.reload(); history.reload();
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
  const active = value?.goal.status === "active";
  const domainLabel = value ? domains.find((domain) => domain.key === value.goal.domain_key)?.label : undefined;
  return <>
    <Link href="/goals" className="mb-2 inline-flex min-h-11 items-center gap-2 rounded-full pr-3 text-sm text-muted-foreground transition-colors duration-[120ms] hover:text-foreground pointer-fine:min-h-8"><ArrowLeft aria-hidden="true" className="size-4" />Все цели</Link>
    {(!value || detail.error) && <PageHeader title="Цель и измерения" />}
    <LoadState loading={detail.loading} error={detail.error} retry={detail.reload} />
    {value && !detail.error && <>
      <PageHeader title={value.goal.title} icon={<DomainIcon domain={value.goal.domain_key} size="lg" />}
        description={<span className="flex flex-wrap items-center gap-1.5">
          {domainLabel && <StatusChip tone={domainPresentation[value.goal.domain_key].tone}>{domainLabel}</StatusChip>}
          <StatusChip>{value.goal.direction === "increase" ? "увеличить ↑" : "уменьшить ↓"}</StatusChip>
          {value.goal.due_at && <StatusChip tone="outline">до <time dateTime={value.goal.due_at}>{formatDate(new Date(value.goal.due_at), preferences)}</time></StatusChip>}
          <StatusBadge status={value.goal.status} />
        </span>}
        actions={active && <>
          <button onClick={() => open({ mode: "goal" })} disabled={detail.loading} className="action-link-secondary action-compact disabled:opacity-50">Изменить цель</button>
          <button onClick={() => open({ mode: "archive" })} disabled={detail.loading} className="action-link-secondary action-compact disabled:opacity-50">В архив</button>
        </>} />
      {message && <div role="status" className="mt-4 rounded-[10px] border border-st-green/40 bg-st-green/10 px-3 py-2.5 text-sm">{message}</div>}
      {!active && <p className="mt-4 rounded-[10px] border bg-surface-2 px-3 py-2.5 text-sm leading-6">Цель в архиве. Измерения и история сохранены и доступны для просмотра. Новые изменения закрыты.</p>}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2" aria-busy={detail.loading}>
        <GoalProgressPanel value={value} preferences={preferences} />
        <SectionCard titleId={MEASUREMENTS_TITLE} title="Измерения" focusableTitle
          description={`Сначала последние по дате измерения · ${preferences.timezone}`}
          action={active && <button onClick={() => open({ mode: "add" })} disabled={detail.loading} className="action-link action-sm disabled:opacity-50"><Plus aria-hidden="true" className="size-3.5" />Добавить измерение</button>}>
          <LoadState loading={history.loading} error={history.error} retry={history.reload} />
          {records && !history.loading && !history.error && <>
            {!records.items.length ? <p className="rounded-[10px] border border-dashed border-border-strong p-5 text-sm leading-6 text-muted-foreground">Измерений пока нет. Добавьте первое значение, чтобы увидеть прогресс.</p>
              : <ol className="grid">{records.items.map((row) => <li key={row.id} className="min-w-0 border-b py-2.5 first:pt-0 last:border-b-0 last:pb-0" data-testid="measurement-row">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <time dateTime={row.measured_at} title={formatDateTime(new Date(row.measured_at), preferences)} className="text-xs text-muted-foreground tabular-nums">{formatShortDateTime(new Date(row.measured_at), preferences)}</time>
                  <span className="text-sm font-semibold wrap-anywhere tabular-nums">{formatGoalValue(row.value, value.goal, preferences.locale)}</span>
                  <SourceLabel>ручной ввод · самоотчёт{row.updated_at !== row.created_at && " · исправлено"}</SourceLabel>
                  {active && <span className="ml-auto flex gap-1"><button onClick={() => open({ mode: "edit", row })} aria-label="Изменить" title="Изменить измерение" className={iconButton}><Pencil aria-hidden="true" className="size-3.5" /></button>
                    <button onClick={() => open({ mode: "delete", row })} aria-label="Удалить" title="Удалить измерение" className={`${iconButton} hover:text-destructive`}><Trash2 aria-hidden="true" className="size-3.5" /></button></span>}
                </div>
                {row.note && <p className="mt-1.5 whitespace-pre-wrap wrap-anywhere text-xs leading-5 text-muted-foreground">{row.note}</p>}</li>)}</ol>}
            {moreError && <div className="mt-4"><FormAlert tone="error">{moreError}</FormAlert></div>}
            {records.nextCursor && <button onClick={loadMore} disabled={moreLoading} className="action-link-secondary action-compact mt-4 disabled:opacity-50">{moreLoading ? "Загружаем…" : "Показать ещё измерения"}</button>}
          </>}
        </SectionCard>
      </div>
      {dialog && <Modal title={dialog.mode === "goal" ? "Изменить цель" : dialog.mode === "add" ? "Новое измерение" : dialog.mode === "edit" ? "Исправить измерение" : dialog.mode === "delete" ? "Удалить измерение?" : "Архивировать цель?"}
        busy={dialogBusy || action.pending || action.uncertain} close={() => setDialog(null)}>
        {dialog.mode === "goal" && <GoalForm initial={value.goal} domains={domains} preferences={preferences} onBusyChange={setDialogBusy} saved={() => saved("Изменения цели сохранены.")}
          cancel={<button type="button" disabled={dialogBusy} onClick={() => setDialog(null)} className="action-link-secondary action-compact disabled:opacity-50">Отмена</button>} />}
        {(dialog.mode === "add" || dialog.mode === "edit") && <MeasurementForm goal={value.goal} initial={dialog.mode === "edit" ? dialog.row : undefined} preferences={preferences} onBusyChange={setDialogBusy} saved={() => saved(dialog.mode === "add" ? "Измерение добавлено." : "Измерение исправлено.")} />}
        {(dialog.mode === "delete" || dialog.mode === "archive") && <div className="grid gap-5"><MutationError error={action.error} uncertain={action.uncertain} />
          <p className="text-sm leading-7">{dialog.mode === "delete" ? <>Будет удалено измерение <strong>{formatGoalValue(dialog.row.value, value.goal, preferences.locale)}</strong> от {formatDateTime(new Date(dialog.row.measured_at), preferences)}. Прогресс обновится, а факт удаления останется в журнале.</>
            : "Цель и её измерения сохранятся в архиве. Добавление, исправление и удаление измерений будут закрыты. Вернуть цель в активные в этом этапе нельзя."}</p>
          <div className="flex flex-wrap justify-end gap-2.5"><button autoFocus disabled={action.pending || action.uncertain} className="action-link-secondary action-compact disabled:opacity-50" onClick={() => setDialog(null)}>Отмена</button>
            <button disabled={action.pending} className="action-link action-compact disabled:opacity-50" onClick={() => {
              if (dialog.mode === "delete") void action.save({ url: `/api/v1/goal-measurements/${dialog.row.id}`, method: "DELETE" }, goalMeasurementDeletionSchema, () => saved("Измерение удалено. Прогресс обновлён."));
              else void action.save({ url: `/api/v1/goals/${id}`, method: "PATCH", body: { status: "archived" } }, goalDetailsSchema, () => saved("Цель перенесена в архив. История сохранена."));
            }}>{action.pending ? "Сохраняем…" : action.uncertain ? "Повторить запрос" : dialog.mode === "delete" ? "Подтвердить удаление" : "Подтвердить архивирование"}</button></div></div>}
      </Modal>}
    </>}
  </>;
}
