"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { goalDetailsSchema, goalMeasurementDeletionSchema, measurementsPageSchema } from "@lifeos/contracts";
import type { GoalMeasurement, MeasurementsPage, UserPreferences } from "@lifeos/contracts";
import { getGoalsData, GoalRequestError } from "../../lib/goals-api-client.ts";
import { formatGoalValue } from "../../lib/goal-presentation.ts";
import { formatDateTime } from "../../lib/user-preferences.ts";
import { FormAlert } from "../auth/form-parts.tsx";
import { GoalForm } from "./goal-form.tsx";
import { MeasurementForm } from "./measurement-form.tsx";
import { GoalProgressView, LoadState, Modal, MutationError, StatusBadge, useGoalData, useGoalMutation } from "./shared.tsx";
import type { DomainChoice } from "./shared.tsx";

type DialogState = { mode: "goal" | "add" | "archive" } | { mode: "edit" | "delete"; row: GoalMeasurement };
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
  const historyTitle = useRef<HTMLHeadingElement>(null);
  const records = more ?? history.data;
  function saved(message: string) {
    setDialog(null); setDialogBusy(false); setMessage(message); setMore(null); setMoreError(null);
    detail.reload(); history.reload();
    setTimeout(() => historyTitle.current?.focus(), 0);
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
  return <>
    <Link href="/goals" className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm text-muted-foreground"><ArrowLeft aria-hidden="true" className="size-4" />Все цели</Link>
    {(!value || detail.error) && <h1 className="text-3xl font-semibold tracking-tight">Цель и измерения</h1>}
    <LoadState loading={detail.loading} error={detail.error} retry={detail.reload} />
    {value && !detail.error && <>
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><p className="text-sm text-muted-foreground">{domains.find((domain) => domain.key === value.goal.domain_key)?.label}</p>
        <h1 className="mt-1 wrap-anywhere text-3xl font-semibold tracking-tight">{value.goal.title}</h1><div className="mt-3"><StatusBadge status={value.goal.status} /></div></div>
        {active && <div className="flex flex-wrap gap-2"><button onClick={() => open({ mode: "goal" })} disabled={detail.loading} className="action-link-secondary disabled:opacity-50">Изменить цель</button>
          <button onClick={() => open({ mode: "archive" })} disabled={detail.loading} className="action-link-secondary disabled:opacity-50">В архив</button></div>}</div>
      {message && <div role="status" className="mt-5 rounded-lg border border-primary/30 bg-secondary p-4 text-sm">{message}</div>}
      {!active && <p className="mt-5 rounded-lg border bg-muted p-4 text-sm leading-6">Цель в архиве. Измерения и история сохранены и доступны для просмотра. Новые изменения закрыты.</p>}
      <section aria-label="Прогресс цели" aria-busy={detail.loading} className="mt-6 min-w-0 rounded-2xl border bg-card p-5 sm:p-7"><GoalProgressView value={value} preferences={preferences} />
        {value.goal.description && <p className="mt-5 whitespace-pre-wrap wrap-anywhere border-t pt-5 text-sm leading-7 text-muted-foreground">{value.goal.description}</p>}
        {value.goal.due_at && <p className="mt-5 text-sm text-muted-foreground">Срок: <time dateTime={value.goal.due_at}>{formatDateTime(new Date(value.goal.due_at), preferences)}</time></p>}
        {active && <button onClick={() => open({ mode: "add" })} disabled={detail.loading} className="action-link mt-6 disabled:opacity-50"><Plus aria-hidden="true" className="size-4" />Добавить измерение</button>}</section>
      <section className="mt-9" aria-labelledby="measurements-title"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="measurements-title" ref={historyTitle} tabIndex={-1} className="rounded text-xl font-semibold">История измерений</h2>
        <p className="text-xs text-muted-foreground">Сначала последние по дате измерения · {preferences.timezone}</p></div>
        <LoadState loading={history.loading} error={history.error} retry={history.reload} />
        {records && !history.loading && !history.error && <>
          {!records.items.length ? <p className="mt-4 rounded-xl border border-dashed p-6 text-sm leading-6 text-muted-foreground">Измерений пока нет. Добавьте первое значение, чтобы увидеть прогресс.</p>
            : <ol className="mt-4 grid gap-3">{records.items.map((row) => <li key={row.id} className="min-w-0 rounded-xl border bg-card p-5" data-testid="measurement-row">
              <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><p className="wrap-anywhere text-lg font-semibold tabular-nums">{formatGoalValue(row.value, value.goal, preferences.locale)}</p>
                <time dateTime={row.measured_at} className="mt-1 block text-sm text-muted-foreground">{formatDateTime(new Date(row.measured_at), preferences)}</time>
                <p className="mt-1 text-xs text-muted-foreground">Ручное измерение · самоотчёт{row.updated_at !== row.created_at && " · исправлено"}</p></div>
                {active && <div className="flex flex-wrap gap-2"><button onClick={() => open({ mode: "edit", row })} className="action-link-secondary">Изменить</button>
                  <button onClick={() => open({ mode: "delete", row })} className="action-link-secondary text-destructive">Удалить</button></div>}</div>
              {row.note && <p className="mt-3 whitespace-pre-wrap wrap-anywhere text-sm leading-6 text-muted-foreground">{row.note}</p>}</li>)}</ol>}
          {moreError && <div className="mt-4"><FormAlert tone="error">{moreError}</FormAlert></div>}
          {records.nextCursor && <button onClick={loadMore} disabled={moreLoading} className="action-link-secondary mt-5 disabled:opacity-50">{moreLoading ? "Загружаем…" : "Показать ещё измерения"}</button>}
        </>}
      </section>
      {dialog && <Modal title={dialog.mode === "goal" ? "Изменить цель" : dialog.mode === "add" ? "Новое измерение" : dialog.mode === "edit" ? "Исправить измерение" : dialog.mode === "delete" ? "Удалить измерение?" : "Архивировать цель?"}
        busy={dialogBusy || action.pending || action.uncertain} close={() => setDialog(null)}>
        {dialog.mode === "goal" && <GoalForm initial={value.goal} domains={domains} preferences={preferences} onBusyChange={setDialogBusy} saved={() => saved("Изменения цели сохранены.")} />}
        {(dialog.mode === "add" || dialog.mode === "edit") && <MeasurementForm goal={value.goal} initial={dialog.mode === "edit" ? dialog.row : undefined} preferences={preferences} onBusyChange={setDialogBusy} saved={() => saved(dialog.mode === "add" ? "Измерение добавлено." : "Измерение исправлено.")} />}
        {(dialog.mode === "delete" || dialog.mode === "archive") && <div className="grid gap-5"><MutationError error={action.error} uncertain={action.uncertain} />
          <p className="text-sm leading-7">{dialog.mode === "delete" ? <>Будет удалено измерение <strong>{formatGoalValue(dialog.row.value, value.goal, preferences.locale)}</strong> от {formatDateTime(new Date(dialog.row.measured_at), preferences)}. Прогресс обновится, а факт удаления останется в журнале.</>
            : "Цель и её измерения сохранятся в архиве. Добавление, исправление и удаление измерений будут закрыты. Вернуть цель в активные в этом этапе нельзя."}</p>
          <div className="flex flex-wrap gap-3"><button autoFocus disabled={action.pending || action.uncertain} className="action-link-secondary disabled:opacity-50" onClick={() => setDialog(null)}>Отмена</button>
            <button disabled={action.pending} className="action-link disabled:opacity-50" onClick={() => {
              if (dialog.mode === "delete") void action.save({ url: `/api/v1/goal-measurements/${dialog.row.id}`, method: "DELETE" }, goalMeasurementDeletionSchema, () => saved("Измерение удалено. Прогресс обновлён."));
              else void action.save({ url: `/api/v1/goals/${id}`, method: "PATCH", body: { status: "archived" } }, goalDetailsSchema, () => saved("Цель перенесена в архив. История сохранена."));
            }}>{action.pending ? "Сохраняем…" : action.uncertain ? "Повторить запрос" : dialog.mode === "delete" ? "Подтвердить удаление" : "Подтвердить архивирование"}</button></div></div>}
      </Modal>}
    </>}
  </>;
}
