"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { goalDetailsSchema, GOAL_UNITS } from "@lifeos/contracts";
import type { DomainKey, Goal, UserPreferences } from "@lifeos/contracts";
import { Field, focusFirstInvalid, FormAlert, SubmitButton } from "../auth/form-parts.tsx";
import { goalFormInput } from "../../lib/goal-form-input.ts";
import type { GoalFieldErrors } from "../../lib/goal-form-input.ts";
import { GOAL_UNIT_LABELS } from "../../lib/goal-presentation.ts";
import { DateTimeField, inputClass, MutationError, TextArea, useGoalMutation } from "./shared.tsx";
import type { DomainChoice } from "./shared.tsx";

export function GoalFields({ initial, domainKey, domains, preferences, errors }: { initial?: Goal; domainKey?: DomainKey; domains: DomainChoice[]; preferences: UserPreferences; errors: GoalFieldErrors }) {
  const [unit, setUnit] = useState<string>(initial?.unit ?? "NOK");
  return <>
    <Field id="title" name="title" label="Название цели" required maxLength={200} defaultValue={initial?.title ?? ""} error={errors.title} placeholder="Накопить 50 000 NOK" />
    <TextArea name="description" label="Описание (необязательно)" initial={initial?.description} maxLength={4000} errors={errors} />
    {!initial && <>
      <div className="grid gap-1.5"><label htmlFor="domain_key" className="text-sm font-medium">Сфера</label>
        <select id="domain_key" name="domain_key" className={inputClass} defaultValue={domainKey ?? ""} required aria-invalid={!!errors.domain_key} aria-describedby={errors.domain_key ? "domain_key-error" : undefined}>
          <option value="" disabled>Выберите сферу</option>{domains.map((domain) => <option key={domain.key} value={domain.key}>{domain.label}</option>)}</select>
        {errors.domain_key && <p id="domain_key-error" className="text-sm text-destructive">{errors.domain_key}</p>}</div>
      <div className="grid gap-5 sm:grid-cols-2"><div className="grid gap-1.5"><label htmlFor="unit" className="text-sm font-medium">Единица измерения</label>
        <select id="unit" name="unit" value={unit} onChange={(event) => setUnit(event.target.value)} className={inputClass}>{GOAL_UNITS.map((value) => <option key={value} value={value}>{GOAL_UNIT_LABELS[value]}</option>)}</select></div>
        <div className="grid gap-1.5"><label htmlFor="direction" className="text-sm font-medium">Направление</label>
          <select id="direction" name="direction" className={inputClass} defaultValue="increase"><option value="increase">Увеличить значение</option><option value="decrease">Уменьшить значение</option></select></div></div>
      {unit === "custom" && <Field id="unit_label" name="unit_label" label="Название своей единицы" required maxLength={40} error={errors.unit_label} placeholder="км" />}
      <div className="grid gap-5 sm:grid-cols-2"><Field id="baseline" name="baseline" type="text" inputMode="decimal" label="Начальное значение" defaultValue="0" required error={errors.baseline} />
        <Field id="target" name="target" type="text" inputMode="decimal" label="Целевое значение" required error={errors.target} /></div>
      <p className="text-xs leading-5 text-muted-foreground">Для NOK — до двух знаков после запятой, для количества — целое число. Начальное значение, единица и направление сохраняются вместе с целью.</p>
    </>}
    {initial && <p className="text-sm leading-6 text-muted-foreground">Можно изменить название, описание и срок. Единица, начальное и целевое значения сохраняют смысл истории измерений.</p>}
    <DateTimeField name="due_at" label="Срок (необязательно)" initial={initial?.due_at} timeZone={preferences.timezone} errors={errors} />
  </>;
}
export function GoalForm({ initial, domainKey, domains, preferences, saved, onBusyChange }: { initial?: Goal; domainKey?: DomainKey; domains: DomainChoice[]; preferences: UserPreferences; saved?(): void; onBusyChange?(busy: boolean): void }) {
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
  return <form onSubmit={submit} noValidate aria-busy={mutation.pending || !!createdId} className="grid gap-5">
    {createdId && <FormAlert tone="success">Цель создана. <Link href={`/goals/${createdId}`} className="underline">Открыть цель</Link></FormAlert>}
    <MutationError error={mutation.error} uncertain={mutation.uncertain} />
    {errors.form && <FormAlert tone="error">{errors.form}</FormAlert>}
    <fieldset disabled={mutation.pending || mutation.uncertain || !!createdId} className="grid min-w-0 gap-5"><legend className="sr-only">Параметры цели</legend>
      <GoalFields initial={initial} domainKey={domainKey} domains={domains} preferences={preferences} errors={errors} /></fieldset>
    <SubmitButton pending={mutation.pending || !!createdId} pendingLabel={createdId ? "Открываем цель…" : "Сохраняем…"}>{mutation.uncertain ? "Повторить сохранение" : initial ? "Сохранить изменения цели" : "Создать цель"}</SubmitButton>
  </form>;
}
