"use client";

import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { goalDetailsSchema, GOAL_UNITS } from "@lifeos/contracts";
import type { DomainKey, Goal, UserPreferences } from "@lifeos/contracts";
import { Field, focusFirstInvalid, FormAlert, SubmitButton } from "../auth/form-parts.tsx";
import { SegmentedChoice } from "../ui/segmented-choice.tsx";
import { goalFormInput } from "../../lib/goal-form-input.ts";
import type { GoalFieldErrors } from "../../lib/goal-form-input.ts";
import { GOAL_UNIT_LABELS } from "../../lib/goal-presentation.ts";
import { DateTimeField, inputClass, MutationError, TextArea, useGoalMutation } from "./shared.tsx";
import type { DomainChoice } from "./shared.tsx";

// Stage 2 knows two directions; «Количество за период» from the mockup needs a metric mode that does not exist yet.
const DIRECTIONS = [{ value: "increase", label: "Увеличить до значения" }, { value: "decrease", label: "Уменьшить до значения" }] as const;

/** «Предпросмотр» from mockup 10: the formula with the numbers the user typed, and why there is no 0%. */
function FormulaPreview({ baseline, target }: { baseline: string; target: string }) {
  const start = baseline.trim() || "старт";
  const goal = target.trim() || "цель";
  return <p className="rounded-[10px] border bg-surface-2 px-3 py-2.5 text-xs leading-5 text-muted-foreground" aria-live="polite">
    Предпросмотр: прогресс = (текущее − {start}) / ({goal} − {start}). Пока нет измерений, на карточке будет «Недостаточно данных», а не 0%.
  </p>;
}

export function GoalFields({ initial, domainKey, domains, preferences, errors }: { initial?: Goal; domainKey?: DomainKey; domains: DomainChoice[]; preferences: UserPreferences; errors: GoalFieldErrors }) {
  const [unit, setUnit] = useState<string>(initial?.unit ?? "NOK");
  const [baseline, setBaseline] = useState("0");
  const [target, setTarget] = useState("");
  if (initial) return <>
    <Field id="title" name="title" label="Название" labelClassName="field-label" required maxLength={200} defaultValue={initial.title} error={errors.title} />
    <TextArea name="description" label="Описание (необязательно)" initial={initial.description} maxLength={4000} errors={errors} rows={2} />
    <p className="text-xs leading-5 text-muted-foreground">Можно изменить название, описание и срок. Единица, начальное и целевое значения сохраняют смысл истории измерений.</p>
    <DateTimeField name="due_at" label="Срок" hint="Необязательно" initial={initial.due_at} timeZone={preferences.timezone} errors={errors} />
  </>;
  return <>
    <SegmentedChoice name="domain_key" legend="Сфера" options={domains.map((domain) => ({ value: domain.key, label: domain.label }))} defaultValue={domainKey} error={errors.domain_key} />
    <Field id="title" name="title" label="Название" labelClassName="field-label" required maxLength={200} error={errors.title} placeholder="Например, накопить на отпуск" />
    <SegmentedChoice name="direction" legend="Как считать прогресс" options={DIRECTIONS} defaultValue="increase" error={errors.direction} />
    <div className="grid gap-2.5 sm:grid-cols-3">
      <div className="grid min-w-0 gap-1.5"><label htmlFor="unit" className="field-label">Единица</label>
        <select id="unit" name="unit" value={unit} onChange={(event) => setUnit(event.target.value)} className={inputClass}>{GOAL_UNITS.map((value) => <option key={value} value={value}>{GOAL_UNIT_LABELS[value]}</option>)}</select></div>
      <Field id="baseline" name="baseline" type="text" inputMode="decimal" label="Старт" labelClassName="field-label" defaultValue="0" required error={errors.baseline} onChange={(event) => setBaseline(event.target.value)} />
      <Field id="target" name="target" type="text" inputMode="decimal" label="Цель" labelClassName="field-label" required error={errors.target} onChange={(event) => setTarget(event.target.value)} />
    </div>
    {unit === "custom" && <Field id="unit_label" name="unit_label" label="Название своей единицы" labelClassName="field-label" required maxLength={40} error={errors.unit_label} placeholder="км" />}
    <p className="-mt-1 text-xs leading-5 text-muted-foreground">Для NOK — до двух знаков после запятой, для количества — целое число. Единица, старт и направление сохраняются вместе с целью.</p>
    <DateTimeField name="due_at" label="Срок" hint="Необязательно" timeZone={preferences.timezone} errors={errors} />
    <TextArea name="description" label="Описание (необязательно)" maxLength={4000} errors={errors} rows={2} />
    <FormulaPreview baseline={baseline} target={target} />
  </>;
}

/**
 * Create or edit a goal. `cancel` is the «Отмена» control: a link back on the standalone page, a button that
 * closes the dialog elsewhere. After creating, the browser opens the new goal.
 */
export function GoalForm({ initial, domainKey, domains, preferences, saved, onBusyChange, cancel }: { initial?: Goal; domainKey?: DomainKey; domains: DomainChoice[]; preferences: UserPreferences; saved?(): void; onBusyChange?(busy: boolean): void; cancel?: ReactNode }) {
  const router = useRouter();
  const mutation = useGoalMutation();
  const [errors, setErrors] = useState<GoalFieldErrors>({});
  const [createdId, setCreatedId] = useState<string | null>(null);
  useEffect(() => { onBusyChange?.(mutation.pending || mutation.uncertain); }, [mutation.pending, mutation.uncertain, onBusyChange]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.pending || createdId) return;
    const form = event.currentTarget;
    const result = mutation.uncertain ? null : goalFormInput(new FormData(form), preferences.timezone, !!initial);
    if (result?.errors) { setErrors(result.errors); focusFirstInvalid(form); return; }
    setErrors({});
    await mutation.save({ url: initial ? `/api/v1/goals/${initial.id}` : "/api/v1/goals", method: initial ? "PATCH" : "POST", body: result?.data }, goalDetailsSchema,
      (value) => { if (saved) saved(); else { setCreatedId(value.goal.id); router.push(`/goals/${value.goal.id}`); } });
  }
  const locked = mutation.pending || mutation.uncertain || !!createdId;
  return <form onSubmit={submit} noValidate aria-busy={mutation.pending || !!createdId} className="grid gap-3.5">
    {createdId && <FormAlert tone="success">Цель создана. <Link href={`/goals/${createdId}`} className="underline">Открыть цель</Link></FormAlert>}
    <MutationError error={mutation.error} uncertain={mutation.uncertain} />
    {errors.form && <FormAlert tone="error">{errors.form}</FormAlert>}
    <fieldset disabled={locked} className="grid min-w-0 gap-3.5"><legend className="sr-only">Параметры цели</legend>
      <GoalFields initial={initial} domainKey={domainKey} domains={domains} preferences={preferences} errors={errors} /></fieldset>
    <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
      <p className="mr-auto min-w-0 basis-60 text-xs leading-5 text-muted-foreground">{initial ? "Изменения попадут в журнал действий." : "Название, описание и срок можно изменить позже; изменения попадут в журнал."}</p>
      {cancel}
      <SubmitButton className="action-compact" pending={mutation.pending || !!createdId} pendingLabel={createdId ? "Открываем цель…" : "Сохраняем…"}>{mutation.uncertain ? "Повторить сохранение" : initial ? "Сохранить изменения цели" : "Создать цель"}</SubmitButton>
    </div>
  </form>;
}
