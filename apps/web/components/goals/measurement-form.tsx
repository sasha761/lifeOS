"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { goalDecimalToScaledInteger, goalMeasurementSchema, goalValueMatchesUnit, scaledIntegerToGoalDecimal } from "@lifeos/contracts";
import type { GoalMeasurement, GoalProgress, NumericGoal, UserPreferences } from "@lifeos/contracts";
import { calculateContributionCurrent, calculateGoalProgress } from "@lifeos/domain";
import { DomainIcon } from "../ui/domain-icon.tsx";
import { formatDate } from "../../lib/user-preferences.ts";
import { Field, focusFirstInvalid, SubmitButton } from "../auth/form-parts.tsx";
import { measurementFormInput } from "../../lib/goal-form-input.ts";
import type { GoalFieldErrors } from "../../lib/goal-form-input.ts";
import { DateTimeField, MutationError, TextArea, useGoalMutation } from "./shared.tsx";
import { formatGoalPercent, formatGoalValue, formatProgressAmount, goalUnitLabel, measurementLabels } from "../../lib/goal-presentation.ts";

function previewProgress(goal: NumericGoal, progress: GoalProgress, value: string, measuredAt: string, initial?: GoalMeasurement) {
  if (goal.measurement_mode === "contributions") {
    const scaled = goalDecimalToScaledInteger;
    const totalBeforeEdit = scaled(progress.contributionTotal ?? "0") - scaled(initial?.value ?? "0");
    if (totalBeforeEdit < 0n) return null;
    const contributionTotal = scaledIntegerToGoalDecimal(totalBeforeEdit + scaled(value));
    return { current: calculateContributionCurrent(goal, contributionTotal), contributionTotal };
  }
  const latest = progress.provenance;
  if (!latest || latest.kind === "example" || measuredAt > latest.measuredAt
    || (measuredAt === latest.measuredAt && (!initial || initial.id === latest.measurementId))) return { current: value };
  // Moving the latest row to an earlier date can expose a row outside the displayed history.
  if (initial?.id === latest.measurementId || measuredAt === latest.measuredAt) return null;
  return { current: progress.current };
}

/** `replacesExample`: the goal shows only example values (LFS-218); the first own value removes them on the server. */
export function MeasurementForm({ goal, progress, initial, preferences, saved, close, onBusyChange, replacesExample = false }: {
  goal: NumericGoal; progress: GoalProgress; initial?: GoalMeasurement; preferences: UserPreferences; saved(): void; close(): void;
  onBusyChange?(busy: boolean): void; replacesExample?: boolean;
}) {
  const mutation = useGoalMutation();
  const [errors, setErrors] = useState<GoalFieldErrors>({});
  const [now] = useState(() => new Date().toISOString());
  const [draft, setDraft] = useState<{ value?: string; measured_at?: string } | null>(initial ?? null);
  const labels = measurementLabels(goal);
  const isContribution = goal.measurement_mode === "contributions";
  const validationError = (value: string) => !goalValueMatchesUnit(value, goal.unit)
    ? "Значение не соответствует точности единицы цели." : isContribution && goalDecimalToScaledInteger(value) === 0n ? "Введите сумму больше нуля." : null;
  const preview = draft?.value && draft.measured_at && !validationError(draft.value)
    ? previewProgress(goal, progress, draft.value, draft.measured_at, initial) : null;
  const percent = preview && calculateGoalProgress({ baseline: goal.baseline, target: goal.target, direction: goal.direction, current: preview.current }).progressPercent;
  const current = initial
    ? `${labels.entry.toLowerCase()} от ${formatDate(new Date(initial.measured_at), preferences)} · ${formatGoalValue(initial.value, goal, preferences.locale)}`
    : formatProgressAmount(goal, progress, preferences.locale, true);
  useEffect(() => { onBusyChange?.(mutation.pending || mutation.uncertain); }, [mutation.pending, mutation.uncertain, onBusyChange]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.pending) return;
    const form = event.currentTarget;
    const result = mutation.uncertain ? null : measurementFormInput(new FormData(form), preferences.timezone, !!initial);
    if (result?.errors) { setErrors(result.errors); focusFirstInvalid(form); return; }
    const valueError = result?.data.value === undefined ? null : validationError(result.data.value);
    if (valueError) { setErrors({ value: valueError }); focusFirstInvalid(form); return; }
    setErrors({});
    await mutation.save({ url: initial ? `/api/v1/goal-measurements/${initial.id}` : `/api/v1/goals/${goal.id}/measurements`, method: initial ? "PATCH" : "POST", body: result?.data }, goalMeasurementSchema, saved);
  }
  return <form onSubmit={submit} onChange={(event) => setDraft(measurementFormInput(new FormData(event.currentTarget), preferences.timezone, !!initial).data)}
    noValidate className="grid gap-3.5" aria-busy={mutation.pending}>
    <MutationError error={mutation.error} uncertain={mutation.uncertain} />
    <div className="flex items-center gap-2.5 rounded-[10px] border bg-surface-2 px-3 py-2.5 text-xs text-muted-foreground">
      <DomainIcon domain={goal.domain_key} size="sm" />
      <p className="min-w-0 wrap-anywhere"><strong className="text-foreground">{goal.title}</strong>{current && <> · {current}</>}</p>
    </div>
    <fieldset disabled={mutation.pending || mutation.uncertain} className="grid min-w-0 gap-3.5"><legend className="sr-only">Данные измерения</legend>
      <Field id="value" name="value" label={`${labels.amount}, ${goalUnitLabel(goal)}`} data-dialog-initial-focus labelClassName="field-label" type="text" inputMode="decimal" required defaultValue={initial?.value ?? ""} error={errors.value} />
      <DateTimeField name="measured_at" label={labels.date} initial={initial?.measured_at ?? now} timeZone={preferences.timezone} required errors={errors} />
      <TextArea name="note" label="Заметка (необязательно)" initial={initial?.note} maxLength={1000} errors={errors} />
      <div className="grid gap-1 rounded-[10px] border bg-surface-2 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
        {preview && preview.current !== null && <p>{initial ? "После исправления" : labels.before}{" — "}
          <strong className="text-foreground">{formatProgressAmount(goal, preview, preferences.locale, true)}</strong>
          {percent !== null && <> · {formatGoalPercent(percent, preferences)}</>}.</p>}
        <p>{initial ? "Правка попадёт в журнал." : "Источник: ручной ввод, самоотчёт. Можно указать прошлую дату."}{replacesExample && " Ваше измерение заменит примерное."}</p>
      </div>
    </fieldset>
    <div className="flex flex-wrap justify-end gap-2.5">
      <button type="button" disabled={mutation.pending || mutation.uncertain} onClick={close} className="action-link-secondary action-compact disabled:opacity-50">Отмена</button>
      <SubmitButton className="action-compact" pending={mutation.pending} pendingLabel="Сохраняем…">
        {mutation.uncertain ? "Повторить сохранение" : initial || !isContribution ? "Сохранить" : labels.add}
      </SubmitButton>
    </div>
  </form>;
}
