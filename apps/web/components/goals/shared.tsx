"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { z } from "zod";
import type { DomainKey, Goal, GoalDetails, UserPreferences } from "@lifeos/contracts";
import { FormAlert } from "../auth/form-parts.tsx";
import { ModalDialog } from "../ui/modal-dialog.tsx";
import { StatusChip } from "../ui/status-chip.tsx";
import { createGoalCommand, getGoalsData, GoalRequestError } from "../../lib/goals-api-client.ts";
import { formatGoalPercent, formatProgressAmount, PHASE_TONES, phaseLabel } from "../../lib/goal-presentation.ts";
import { instantToLocalDate, instantToLocalInput, zonedInstantChoices } from "../../lib/goal-time.ts";
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
  const retry = useRef<{ url: string; method: "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  // HTTP status of the last definitive failure (LFS-220: a 409 of the example or the setup gets its own message).
  const [status, setStatus] = useState<number | null>(null);
  return { pending, error, uncertain, status,
    async save<T extends z.ZodType>(command: { url: string; method: "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown }, schema: T, saved: (value: z.infer<T>) => void) {
      if (lock.current) return;
      lock.current = true; setPending(true); setError(null); setStatus(null);
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
        setStatus(error instanceof GoalRequestError && !unresolved ? error.status : null);
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
export function TextArea({ name, label, initial, maxLength, errors, rows = 3 }: { name: string; label: string; initial?: string | null; maxLength: number; errors: GoalFieldErrors; rows?: number }) {
  return <div className="grid gap-1.5"><label htmlFor={name} className="field-label">{label}</label>
    <textarea id={name} name={name} defaultValue={initial ?? ""} maxLength={maxLength} rows={rows} className={inputClass} aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `${name}-error` : undefined} />
    {errors[name] && <p id={`${name}-error`} className="text-sm text-destructive">{errors[name]}</p>}</div>;
}
export function DateTimeField({ name, label, hint, initial, timeZone, required, errors }: { name: string; label: string; hint?: string; initial?: string | null; timeZone: string; required?: boolean; errors: GoalFieldErrors }) {
  const [local, setLocal] = useState(() => initial ? instantToLocalInput(initial, timeZone) : "");
  const [offset, setOffset] = useState(() => initial ? zonedInstantChoices(instantToLocalInput(initial, timeZone), timeZone).find((choice) => choice.instant === initial)?.offset ?? "" : "");
  const choices = local ? zonedInstantChoices(local, timeZone) : [];
  return <div className="grid min-w-0 gap-1.5"><label htmlFor={name} className="field-label">{label}</label>
    <input type="datetime-local" id={name} name={name} value={local} onChange={(event) => { setLocal(event.target.value); setOffset(""); }} step="0.001" required={required}
      className={inputClass} aria-invalid={!!errors[name]} aria-describedby={`${name}-hint${errors[name] ? ` ${name}-error` : ""}`} />
    <p id={`${name}-hint`} className="text-xs leading-5 text-muted-foreground">{hint ? `${hint} · ` : ""}Часовой пояс: {timeZone}.</p>
    {choices.length > 1 && <><label htmlFor={`${name}_offset`} className="field-label">Смещение UTC при переводе часов</label>
      <select id={`${name}_offset`} name={`${name}_offset`} value={offset} onChange={(event) => setOffset(event.target.value)} className={inputClass} required>
        <option value="">Выберите смещение</option>{choices.map((choice) => <option key={choice.instant} value={choice.offset}>{choice.offset}</option>)}</select></>}
    {errors[name] && <p id={`${name}-error`} className="text-sm text-destructive">{errors[name]}</p>}</div>;
}
/**
 * Date-only, optional deadline (mockup 10, LFS-213/217). The stored instant is the end of the chosen day in the account's
 * zone; an unchanged date sends the original instant back (`<name>_original`), so older deadlines keep their time.
 * «Убрать срок» empties the field: an empty date saves a goal without a deadline. The input stays uncontrolled, so a
 * partly typed date is never overwritten.
 */
export function DateField({ name, label, describedBy, initial, timeZone, errors, clearLabel = "Убрать срок" }: { name: string; label: string; describedBy?: string; initial?: string | null; timeZone: string; errors: GoalFieldErrors; clearLabel?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [filled, setFilled] = useState(!!initial);
  const described = [describedBy, errors[name] ? `${name}-error` : null].filter(Boolean).join(" ") || undefined;
  return <div className="grid min-w-0 gap-1.5"><label htmlFor={name} className="field-label">{label}</label>
    <input ref={input} type="date" id={name} name={name} defaultValue={initial ? instantToLocalDate(initial, timeZone) : ""} className={inputClass}
      aria-invalid={!!errors[name]} aria-describedby={described} onChange={(event) => setFilled(event.currentTarget.value !== "")} />
    {initial && <input type="hidden" name={`${name}_original`} value={initial} />}
    {filled && <button type="button" className="action-link-secondary action-sm justify-self-start"
      onClick={() => { if (input.current) { input.current.value = ""; input.current.focus(); } setFilled(false); }}>{clearLabel}</button>}
    {errors[name] && <p id={`${name}-error`} className="text-sm text-destructive">{errors[name]}</p>}</div>;
}
/** «12 000 из 50 000 NOK · 24%» (mockups 09/10); the percentage keeps its own element for tests and screen readers. */
export function GoalAmount({ value, preferences, percentTestId }: { value: GoalDetails; preferences: UserPreferences; percentTestId?: string }) {
  const { goal, progress } = value;
  if (goal.kind !== "numeric" || progress.current === null) return null;
  return <span className="min-w-0 text-xs leading-5 wrap-anywhere tabular-nums">
    {formatProgressAmount(goal, progress, preferences.locale, goal.measurement_mode === "contributions")}
    {progress.progressPercent !== null && <> · <span data-testid={percentTestId}>{formatGoalPercent(progress.progressPercent, preferences)}</span></>}
  </span>;
}
export function Modal({ title, children, close, busy = false, role = "dialog", describedBy }: { title: string; children: ReactNode; close(): void; busy?: boolean; role?: "dialog" | "alertdialog"; describedBy?: string }) {
  return <ModalDialog role={role} labelledBy="goal-dialog-title" describedBy={describedBy} busy={busy} onClose={close}
    className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[560px] rounded-[20px] px-5 py-5 sm:px-6 sm:py-[22px]">
    <div className="mb-3.5 flex items-center justify-between gap-4"><h2 id="goal-dialog-title" className="text-base leading-[22px] font-bold">{title}</h2>
      <CloseButton disabled={busy} onClick={close} /></div>{children}</ModalDialog>;
}
/** Round ✕ button of dialogs (mockup `.ib`); the accessible name stays «Закрыть». */
export function CloseButton({ onClick, disabled }: { onClick(): void; disabled?: boolean }) {
  return <button type="button" aria-label="Закрыть" disabled={disabled} onClick={onClick}
    className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border text-muted-foreground transition-colors duration-[120ms] hover:border-border-strong hover:bg-surface-3 hover:text-foreground disabled:opacity-50 pointer-coarse:size-11">
    <X aria-hidden="true" className="size-4" /></button>;
}
/** Status of a goal (LFS-225, mockups 32–36): «В архиве», or the phase the person set («В процессе», «✓ Достигнута»…). */
export function GoalStatusChip({ goal }: { goal: Pick<Goal, "status" | "phase"> }) {
  if (goal.status === "archived") return <StatusChip tone="gray">В архиве</StatusChip>;
  return <StatusChip tone={PHASE_TONES[goal.phase]}>{phaseLabel(goal.phase)}</StatusChip>;
}
/** «Пример» (mockup 28, `.chip.c-a`): a goal of the loaded example or an example value, never the person's data (LFS-218). */
export function ExampleChip({ className }: { className?: string }) {
  return <StatusChip tone="amber" className={className}>Пример</StatusChip>;
}
