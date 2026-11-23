"use client";

import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { goalDetailsSchema, GOAL_UNITS } from "@lifeos/contracts";
import type { DomainKey, Goal, UserPreferences } from "@lifeos/contracts";
import { Field, focusFirstInvalid, FormAlert, SubmitButton } from "../auth/form-parts.tsx";
import { SegmentedChoice } from "../ui/segmented-choice.tsx";
import { goalFormInput } from "../../lib/goal-form-input.ts";
import type { GoalFieldErrors } from "../../lib/goal-form-input.ts";
import { goalUnitOptionLabel } from "../../lib/goal-presentation.ts";
import { DateField, inputClass, MutationError, TextArea, useGoalMutation } from "./shared.tsx";
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

/**
 * Mockup 10: one row Единица / Старт / Цель / Срок; the deadline is an optional date (end of that day in the account's
 * zone). Editing shows the same definition fields while the goal has no measurements (LFS-217); after the first
 * measurement only the title, description and dates change. An edit has its own row «Дата начала · Срок» (LFS-225: the
 * start is the beginning of that day); a goal without measurements has no definition at all.
 */
export function GoalFields({ initial, definitionEditable = !initial, replacesExample = false, domainKey, domains, preferences, errors }: { initial?: Goal; definitionEditable?: boolean; replacesExample?: boolean; domainKey?: DomainKey; domains: DomainChoice[]; preferences: UserPreferences; errors: GoalFieldErrors }) {
  const [unit, setUnit] = useState<string>(initial?.unit ?? "NOK");
  const [baseline, setBaseline] = useState(initial?.baseline ?? "0");
  const [target, setTarget] = useState(initial?.target ?? "");
  const numeric = initial?.kind !== "unmeasured";
  const [describing, setDescribing] = useState(false);
  const hint = <p id="goal-fields-hint" className="-mt-1 text-xs leading-5 text-muted-foreground">
    {definitionEditable ? "NOK и $ — до 2 знаков после запятой, шт. и мин — целые. " : ""}{initial ? "Дата начала — с начала выбранного дня, срок — до его конца" : "Срок действует до конца выбранного дня"} ({preferences.timezone}).
    {replacesExample && " Если изменить старт, цель или единицу, примерное измерение удалится: оно относится к прежним значениям."}</p>;
  const deadline = <DateField name="due_at" label="Срок · необязательно" describedBy="goal-fields-hint" initial={initial?.due_at} timeZone={preferences.timezone} errors={errors} />;
  const dates = <div className="grid gap-2.5 sm:max-w-md sm:grid-cols-2">
    <DateField name="starts_at" label="Дата начала · необязательно" describedBy="goal-fields-hint" initial={initial?.starts_at} timeZone={preferences.timezone} errors={errors} clearLabel="Убрать дату начала" />
    {deadline}</div>;
  const definition = <>
    <SegmentedChoice name="direction" legend="Как считать прогресс" options={DIRECTIONS} defaultValue={initial?.direction ?? "increase"} error={errors.direction} />
    {/* The deadline column is wider than on mockup 10: «Срок · необязательно» and the date mask stay on one line. */}
    <div className={`grid grid-cols-2 items-start gap-2.5 ${initial ? "sm:grid-cols-3" : "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.45fr)]"}`}>
      <div className="grid min-w-0 gap-1.5"><label htmlFor="unit" className="field-label">Единица</label>
        <select id="unit" name="unit" value={unit} onChange={(event) => setUnit(event.target.value)} className={inputClass}>{GOAL_UNITS.map((value) => <option key={value} value={value}>{goalUnitOptionLabel(value)}</option>)}</select></div>
      <Field id="baseline" name="baseline" type="text" inputMode="decimal" label="Старт" labelClassName="field-label" defaultValue={initial?.baseline ?? "0"} required error={errors.baseline} onChange={(event) => setBaseline(event.target.value)} />
      <Field id="target" name="target" type="text" inputMode="decimal" label="Цель" labelClassName="field-label" defaultValue={initial?.target ?? undefined} required error={errors.target} onChange={(event) => setTarget(event.target.value)} />
      {!initial && deadline}
    </div>
    {unit === "custom" && <Field id="unit_label" name="unit_label" label="Название своей единицы" labelClassName="field-label" required maxLength={40} defaultValue={initial?.unit_label ?? undefined} error={errors.unit_label} placeholder="км" />}
  </>;
  if (initial) {
    const title = <Field id="title" name="title" label="Название" labelClassName="field-label" required maxLength={200} defaultValue={initial.title} error={errors.title} />;
    const description = <TextArea name="description" label="Описание (необязательно)" initial={initial.description} maxLength={4000} errors={errors} rows={2} />;
    // Without measurements the order is that of «Новая цель» (mockup 10): definition, dates, hint, description, preview.
    if (definitionEditable && numeric) return <>{title}{definition}{dates}{hint}{description}<FormulaPreview baseline={baseline} target={target} /></>;
    return <>
      {title}{description}
      {dates}
      {hint}
      {numeric && <p className="text-xs leading-5 text-muted-foreground">Старт и цель фиксируются после первого измерения, чтобы история измерений не меняла смысл.</p>}
    </>;
  }
  const describe = describing || !!errors.description;
  return <>
    <SegmentedChoice name="domain_key" legend="Сфера" options={domains.map((domain) => ({ value: domain.key, label: domain.label }))} defaultValue={domainKey} error={errors.domain_key} />
    <Field id="title" name="title" label="Название" labelClassName="field-label" required maxLength={200} error={errors.title} placeholder="Например, накопить на отпуск" />
    {definition}
    {hint}
    {describe
      ? <TextArea name="description" label="Описание (необязательно)" maxLength={4000} errors={errors} rows={2} />
      : <div><button type="button" aria-label="Добавить описание" onClick={() => { setDescribing(true); setTimeout(() => document.getElementById("description")?.focus(), 0); }} className="action-link-secondary action-sm"><Plus aria-hidden="true" className="size-3.5" />Описание</button></div>}
    <FormulaPreview baseline={baseline} target={target} />
  </>;
}

/**
 * Create or edit a goal. `cancel` is the «Отмена» control: a link back on the standalone page, a button that
 * closes the dialog elsewhere. After creating, the browser opens the new goal.
 */
export function GoalForm({ initial, definitionEditable, replacesExample, domainKey, domains, preferences, saved, onBusyChange, cancel }: { initial?: Goal; definitionEditable?: boolean; replacesExample?: boolean; domainKey?: DomainKey; domains: DomainChoice[]; preferences: UserPreferences; saved?(): void; onBusyChange?(busy: boolean): void; cancel?: ReactNode }) {
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
      <GoalFields initial={initial} definitionEditable={definitionEditable} replacesExample={replacesExample} domainKey={domainKey} domains={domains} preferences={preferences} errors={errors} /></fieldset>
    <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
      {/* One row as on mockup 10: from sm an edit's narrower note leaves room for «Отмена» and «Сохранить изменения цели»;
          on a phone the note takes its own line above both buttons, as in «Новая цель». */}
      <p className={`mr-auto min-w-0 ${initial ? "grow basis-60 sm:basis-48" : "basis-60"} text-xs leading-5 text-muted-foreground`}>{initial ?"Изменения попадут в журнал действий." : "Цель можно изменить позже, изменения попадут в журнал."}</p>
      {cancel}
      <SubmitButton className="action-compact" pending={mutation.pending || !!createdId} pendingLabel={createdId ? "Открываем цель…" : "Сохраняем…"}>{mutation.uncertain ? "Повторить сохранение" : initial ? "Сохранить изменения цели" : "Создать цель"}</SubmitButton>
    </div>
  </form>;
}
