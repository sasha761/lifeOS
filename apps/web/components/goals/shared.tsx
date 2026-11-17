"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { z } from "zod";
import type { DomainKey, Goal, GoalDetails, UserPreferences } from "@lifeos/contracts";
import { FormAlert } from "../auth/form-parts.tsx";
import { createGoalCommand, getGoalsData, GoalRequestError } from "../../lib/goals-api-client.ts";
import { formatGoalPercent, formatGoalValue } from "../../lib/goal-presentation.ts";
import { instantToLocalInput, zonedInstantChoices } from "../../lib/goal-time.ts";
import { formatDateTime } from "../../lib/user-preferences.ts";
import type { GoalFieldErrors } from "../../lib/goal-form-input.ts";

export type DomainChoice = { key: DomainKey; label: string };
export const inputClass = "field-control";
function signIn() { window.location.assign(`/auth/sign-in?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); }
export function useGoalData<T extends z.ZodType>(url: string, schema: T) {
  const [data, setData] = useState<z.infer<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError(null);
    getGoalsData(url, schema, abort.signal).then((value) => { if (!abort.signal.aborted) setData(value); }).catch((error: unknown) => {
      if (abort.signal.aborted) return;
      if (error instanceof GoalRequestError && error.status === 401) { signIn(); return; }
      setError(error instanceof GoalRequestError ? error.message : "Не удалось загрузить данные. Проверьте соединение.");
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [url, schema, revision]);
  return { data, error, loading, reload: () => setRevision((value) => value + 1) };
}
export function useGoalMutation() {
  const client = useRef<ReturnType<typeof createGoalCommand> | null>(null);
  const lock = useRef(false);
  const retry = useRef<{ url: string; method: "POST" | "PATCH" | "DELETE"; body?: unknown } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  return { pending, error, uncertain,
    async save<T extends z.ZodType>(command: { url: string; method: "POST" | "PATCH" | "DELETE"; body?: unknown }, schema: T, saved: (value: z.infer<T>) => void) {
      if (lock.current) return;
      lock.current = true; setPending(true); setError(null);
      client.current ??= createGoalCommand();
      try {
        const value = await client.current.run(retry.current ?? command, schema);
        retry.current = null; setUncertain(false);
        if (value !== undefined) saved(value);
      } catch (error) {
        if (error instanceof GoalRequestError && error.status === 401) { signIn(); return; }
        const unresolved = error instanceof GoalRequestError && error.uncertain;
        retry.current = unresolved ? retry.current ?? command : null;
        setUncertain(unresolved);
        setError(error instanceof GoalRequestError ? error.message : "Не удалось сохранить изменения.");
      } finally { lock.current = false; setPending(false); }
    },
  };
}
export function LoadState({ loading, error, retry }: { loading: boolean; error: string | null; retry(): void }) {
  if (error) return <div className="my-6 space-y-3"><FormAlert tone="error">{error}</FormAlert><button className="action-link-secondary" onClick={retry}>Повторить загрузку</button></div>;
  if (loading) return <p className="my-6 animate-pulse text-sm text-muted-foreground" role="status">Загружаем данные…</p>;
  return null;
}
export function MutationError({ error, uncertain }: { error: string | null; uncertain: boolean }) {
  return error ? <FormAlert tone="error">{error}{uncertain && <p className="mt-1">Данные зафиксированы для повтора. Нажмите кнопку отправки ещё раз: повтор не создаст вторую запись.</p>}</FormAlert> : null;
}
export function TextArea({ name, label, initial, maxLength, errors }: { name: string; label: string; initial?: string | null; maxLength: number; errors: GoalFieldErrors }) {
  return <div className="grid gap-1.5"><label htmlFor={name} className="text-sm font-medium">{label}</label>
    <textarea id={name} name={name} defaultValue={initial ?? ""} maxLength={maxLength} rows={3} className={inputClass} aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `${name}-error` : undefined} />
    {errors[name] && <p id={`${name}-error`} className="text-sm text-destructive">{errors[name]}</p>}</div>;
}
export function DateTimeField({ name, label, initial, timeZone, required, errors }: { name: string; label: string; initial?: string | null; timeZone: string; required?: boolean; errors: GoalFieldErrors }) {
  const [local, setLocal] = useState(() => initial ? instantToLocalInput(initial, timeZone) : "");
  const [offset, setOffset] = useState(() => initial ? zonedInstantChoices(instantToLocalInput(initial, timeZone), timeZone).find((choice) => choice.instant === initial)?.offset ?? "" : "");
  const choices = local ? zonedInstantChoices(local, timeZone) : [];
  return <div className="grid min-w-0 gap-1.5"><label htmlFor={name} className="text-sm font-medium">{label}</label>
    <input type="datetime-local" id={name} name={name} value={local} onChange={(event) => { setLocal(event.target.value); setOffset(""); }} step="0.001" required={required}
      className={inputClass} aria-invalid={!!errors[name]} aria-describedby={`${name}-hint${errors[name] ? ` ${name}-error` : ""}`} />
    <p id={`${name}-hint`} className="text-xs leading-5 text-muted-foreground">Часовой пояс: {timeZone}.</p>
    {choices.length > 1 && <><label htmlFor={`${name}_offset`} className="text-sm font-medium">Смещение UTC при переводе часов</label>
      <select id={`${name}_offset`} name={`${name}_offset`} value={offset} onChange={(event) => setOffset(event.target.value)} className={inputClass} required>
        <option value="">Выберите смещение</option>{choices.map((choice) => <option key={choice.instant} value={choice.offset}>{choice.offset}</option>)}</select></>}
    {errors[name] && <p id={`${name}-error`} className="text-sm text-destructive">{errors[name]}</p>}</div>;
}
export function GoalProgressView({ value, preferences, compact = false }: { value: GoalDetails; preferences: UserPreferences; compact?: boolean }) {
  const { goal, progress } = value;
  const formatted = (amount: string) => formatGoalValue(amount, goal, preferences.locale);
  return <div className="min-w-0">
    {progress.current === null ? <><p className={`${compact ? "text-[17px] leading-6" : "text-2xl"} font-semibold`}>Недостаточно данных</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Добавьте первое измерение. Начальное значение само по себе не подтверждает прогресс.</p>
      <p className="mt-3 wrap-anywhere text-sm">Целевое значение: <strong>{formatted(goal.target)}</strong></p></>
      : <><p className={`${compact ? "text-xl" : "text-[2rem] leading-9"} wrap-anywhere font-bold tracking-[-0.02em] tabular-nums`} data-testid="goal-values">{formatted(progress.current)} <span className="text-base font-normal text-muted-foreground">/ {formatted(goal.target)}</span></p>
        <div className="mt-4 flex items-center gap-3"><progress max={100} value={progress.progressPercent ?? 0} aria-label="Прогресс к цели" className="h-2 w-full min-w-0 appearance-none overflow-hidden rounded-full bg-surface-3 [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-surface-3 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary" />
          <span className="shrink-0 text-sm font-semibold tabular-nums" data-testid="goal-percent">{progress.progressPercent === null ? "—" : formatGoalPercent(progress.progressPercent, preferences)}</span></div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">Источник: ручное измерение · самоотчёт{progress.provenance && <> · <time dateTime={progress.provenance.measuredAt}>{formatDateTime(new Date(progress.provenance.measuredAt), preferences)}</time></>}</p></>}
    {!compact && <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-muted-foreground">Начальное значение</dt><dd className="mt-1 wrap-anywhere font-medium">{formatted(goal.baseline)}</dd></div>
      <div><dt className="text-muted-foreground">Направление</dt><dd className="mt-1 font-medium">{goal.direction === "increase" ? "Увеличить" : "Уменьшить"}</dd></div>
      <div><dt className="text-muted-foreground">Измерений</dt><dd className="mt-1 font-medium">{progress.measurementCount}</dd></div></dl>}
  </div>;
}
export function Modal({ title, children, close, busy = false }: { title: string; children: ReactNode; close(): void; busy?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} aria-labelledby="goal-dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) close(); }}
    onKeyDown={(event) => {
      if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])")]
        .filter((control) => control.getClientRects().length > 0);
      const first = controls[0]; const last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}
    className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-[14px] border bg-card p-5 text-foreground shadow-[0_8px_24px_rgb(0_0_0/0.35)] backdrop:bg-background/75 sm:p-7">
    <div className="mb-5 flex items-start justify-between gap-4"><h2 id="goal-dialog-title" className="text-xl font-semibold">{title}</h2>
      <button type="button" disabled={busy} onClick={close} className="min-h-11 shrink-0 rounded-full px-3 text-sm text-muted-foreground transition-colors duration-[120ms] hover:bg-surface-3 hover:text-foreground disabled:opacity-50">Закрыть</button></div>{children}</dialog>;
}
export function StatusBadge({ status }: { status: Goal["status"] }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${status === "archived" ? "bg-st-gray/20 text-muted-foreground" : "bg-st-green/15 text-st-green"}`}>{status === "archived" ? "В архиве" : "Активна"}</span>;
}
