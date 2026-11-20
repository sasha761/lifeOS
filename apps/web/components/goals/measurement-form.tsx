"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { goalMeasurementSchema, goalValueMatchesUnit } from "@lifeos/contracts";
import type { Goal, GoalMeasurement, UserPreferences } from "@lifeos/contracts";
import { Field, focusFirstInvalid, SubmitButton } from "../auth/form-parts.tsx";
import { measurementFormInput } from "../../lib/goal-form-input.ts";
import type { GoalFieldErrors } from "../../lib/goal-form-input.ts";
import { DateTimeField, MutationError, TextArea, useGoalMutation } from "./shared.tsx";
import { GOAL_UNIT_LABELS } from "../../lib/goal-presentation.ts";

export function MeasurementForm({ goal, initial, preferences, saved, onBusyChange }: { goal: Goal; initial?: GoalMeasurement; preferences: UserPreferences; saved(): void; onBusyChange?(busy: boolean): void }) {
  const mutation = useGoalMutation();
  const [errors, setErrors] = useState<GoalFieldErrors>({});
  const [now] = useState(() => new Date().toISOString());
  useEffect(() => { onBusyChange?.(mutation.pending || mutation.uncertain); }, [mutation.pending, mutation.uncertain, onBusyChange]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.pending) return;
    const form = event.currentTarget;
    const result = mutation.uncertain ? null : measurementFormInput(new FormData(form), preferences.timezone, !!initial);
    if (result?.errors) { setErrors(result.errors); focusFirstInvalid(form); return; }
    if (result?.data && !goalValueMatchesUnit(result.data.value!, goal.unit)) { setErrors({ value: "Значение не соответствует точности единицы цели." }); focusFirstInvalid(form); return; }
    setErrors({});
    await mutation.save({ url: initial ? `/api/v1/goal-measurements/${initial.id}` : `/api/v1/goals/${goal.id}/measurements`, method: initial ? "PATCH" : "POST", body: result?.data }, goalMeasurementSchema, saved);
  }
  return <form onSubmit={submit} noValidate className="grid gap-3.5" aria-busy={mutation.pending}>
    <MutationError error={mutation.error} uncertain={mutation.uncertain} />
    {initial && <p className="text-xs leading-5 text-muted-foreground">Проверьте исправленные данные перед подтверждением. Прежнее значение останется в журнале изменений.</p>}
    <fieldset disabled={mutation.pending || mutation.uncertain} className="grid min-w-0 gap-3.5"><legend className="sr-only">Данные измерения</legend>
      <Field id="value" name="value" label={`Значение (${goal.unit === "custom" ? goal.unit_label : GOAL_UNIT_LABELS[goal.unit]})`} labelClassName="field-label" type="text" inputMode="decimal" required defaultValue={initial?.value ?? ""} error={errors.value} />
      <DateTimeField name="measured_at" label="Дата и время измерения" initial={initial?.measured_at ?? now} timeZone={preferences.timezone} required errors={errors} />
      <TextArea name="note" label="Заметка (необязательно)" initial={initial?.note} maxLength={1000} errors={errors} />
      <p className="rounded-[10px] border bg-surface-2 px-3 py-2.5 text-xs leading-5 text-muted-foreground">Источник: ручной ввод, самоотчёт. Можно добавить запись за прошлую дату; будущее ограничено пятью минутами.</p></fieldset>
    <div className="flex justify-end pt-1"><SubmitButton className="action-compact" pending={mutation.pending} pendingLabel="Сохраняем…">{mutation.uncertain ? "Повторить сохранение" : initial ? "Подтвердить изменения измерения" : "Добавить измерение"}</SubmitButton></div>
  </form>;
}
