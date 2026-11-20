import { createGoalInputSchema, createGoalMeasurementInputSchema, updateGoalInputSchema, updateGoalMeasurementInputSchema } from "@lifeos/contracts";
import type { z } from "zod";
import { endOfLocalDay, instantToLocalDate, resolveGoalTime } from "./goal-time.ts";

export type GoalFieldErrors = Record<string, string>;
export type FormResult<T> = { data: T; errors: null } | { data: null; errors: GoalFieldErrors };
const text = (values: FormData, name: string) => String(values.get(name) ?? "");
const nullable = (value: string) => value.trim() || null;
const decimal = (value: string) => value.trim().replace(",", ".");
const messages: Record<string, string> = { title: "Введите название (до 200 символов).", description: "Описание — до 4000 символов.", domain_key: "Выберите сферу.",
  unit: "Выберите единицу.", unit_label: "Укажите название единицы (до 40 символов).", baseline: "Укажите неотрицательное точное число в выбранной единице.",
  target: "Цель должна отличаться от начального значения и соответствовать направлению и единице.", value: "Укажите неотрицательное точное число в единице цели.",
  note: "Заметка — до 1000 символов.", direction: "Выберите направление изменения." };
function validate<T extends z.ZodType>(schema: T, input: unknown): FormResult<z.infer<T>> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { data: parsed.data, errors: null };
  const errors: GoalFieldErrors = {};
  for (const issue of parsed.error.issues) { const field = String(issue.path[0] ?? "form"); errors[field] ??= messages[field] ?? "Проверьте значение поля."; }
  return { data: null, errors };
}
function dateValue(values: FormData, name: string, timeZone: string): string | null {
  const value = text(values, name);
  return value ? resolveGoalTime(value, timeZone, nullable(text(values, `${name}_offset`))) : null;
}
/**
 * Date-only deadline (LFS-213): the end of the chosen day in the account's zone. A stored deadline whose
 * calendar date was not changed is sent back unchanged, so older deadlines with a time of day keep it.
 */
function deadlineValue(values: FormData, timeZone: string): string | null {
  const date = text(values, "due_at");
  if (!date) return null;
  const original = nullable(text(values, "due_at_original"));
  if (original && instantToLocalDate(original, timeZone) === date) return original;
  return endOfLocalDay(date, timeZone);
}
export function goalFormInput(values: FormData, timeZone: string, editing = false) {
  let due_at: string | null;
  try { due_at = deadlineValue(values, timeZone); }
  catch (error) { return { data: null, errors: { due_at: (error as Error).message } } as const; }
  const metadata = { title: text(values, "title"), description: nullable(text(values, "description")), due_at };
  const definition = () => ({ baseline: decimal(text(values, "baseline")), target: decimal(text(values, "target")), unit: text(values, "unit"),
    unit_label: text(values, "unit") === "custom" ? nullable(text(values, "unit_label")) : null, direction: text(values, "direction") });
  // An edit carries the definition only when the form shows it, i.e. while the goal has no measurements (LFS-217).
  if (editing) return validate(updateGoalInputSchema, values.has("unit") ? { ...metadata, ...definition() } : metadata);
  return validate(createGoalInputSchema, { ...metadata, domain_key: text(values, "domain_key"), ...definition() });
}
export function measurementFormInput(values: FormData, timeZone: string, editing = false) {
  let measured_at: string | null;
  try { measured_at = dateValue(values, "measured_at", timeZone); }
  catch (error) { return { data: null, errors: { measured_at: (error as Error).message } } as const; }
  if (!measured_at) return { data: null, errors: { measured_at: "Укажите дату и время измерения." } } as const;
  const data = { value: decimal(text(values, "value")), measured_at, note: nullable(text(values, "note")) };
  return editing ? validate(updateGoalMeasurementInputSchema, data) : validate(createGoalMeasurementInputSchema, { ...data, source: "manual" });
}
