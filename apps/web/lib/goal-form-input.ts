import { createGoalMeasurementInputSchema, createNumericGoalInputSchema, updateGoalInputSchema, updateGoalMeasurementInputSchema } from "@lifeos/contracts";
import type { z } from "zod";
import { endOfLocalDay, instantToLocalDate, resolveGoalTime, startOfLocalDay } from "./goal-time.ts";

export type GoalFieldErrors = Record<string, string>;
export type FormResult<T> = { data: T; errors: null } | { data: null; errors: GoalFieldErrors };
const text = (values: FormData, name: string) => String(values.get(name) ?? "");
const nullable = (value: string) => value.trim() || null;
const decimal = (value: string) => value.trim().replace(",", ".");
export const measurementDecimal = (value: string) => decimal(value).replace(/(?<=\d)[ \u00a0\u202f](?=\d{3}(?:[ \u00a0\u202f]|\.|$))/g, "");
const messages: Record<string, string> = { title: "Введите название (до 200 символов).", description: "Описание — до 4000 символов.", domain_key: "Выберите сферу.",
  unit: "Выберите единицу.", unit_label: "Укажите название единицы (до 40 символов).", baseline: "Укажите неотрицательное точное число в выбранной единице.",
  target: "Цель должна отличаться от начального значения и соответствовать направлению и единице.", value: "Укажите неотрицательное точное число в единице цели.",
  note: "Заметка — до 1000 символов.", direction: "Выберите направление изменения.", starts_at: "Дата начала не может быть позже срока." };
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
 * Date-only start (LFS-225) and deadline (LFS-213): the start or the end of the chosen day in the account's zone. A stored
 * date whose calendar day was not changed is sent back unchanged, so older deadlines with a time of day keep it.
 */
function dayValue(values: FormData, name: "starts_at" | "due_at", timeZone: string): string | null {
  const date = text(values, name);
  if (!date) return null;
  const original = nullable(text(values, `${name}_original`));
  if (original && instantToLocalDate(original, timeZone) === date) return original;
  return name === "starts_at" ? startOfLocalDay(date, timeZone) : endOfLocalDay(date, timeZone);
}
export function goalFormInput(values: FormData, timeZone: string, editing = false) {
  const dates: { starts_at?: string | null; due_at: string | null } = { due_at: null };
  for (const name of ["starts_at", "due_at"] as const) {
    // «Новая цель» has no start field yet (LFS-228): then the start is not sent at all.
    if (name === "starts_at" && !values.has("starts_at")) continue;
    try { dates[name] = dayValue(values, name, timeZone); }
    catch (error) { return { data: null, errors: { [name]: (error as Error).message } } as const; }
  }
  const metadata = { title: text(values, "title"), description: nullable(text(values, "description")), ...dates,
    ...(values.has("measurement_mode") ? { measurement_mode: text(values, "measurement_mode") } : {}) };
  const definition = () => ({ baseline: decimal(text(values, "baseline")), target: decimal(text(values, "target")), unit: text(values, "unit"),
    unit_label: text(values, "unit") === "custom" ? nullable(text(values, "unit_label")) : null, direction: text(values, "direction") });
  // An edit carries the definition only when the form shows it, i.e. while the goal has no measurements (LFS-217).
  if (editing) return validate(updateGoalInputSchema, values.has("unit") ? { ...metadata, ...definition() } : metadata);
  return validate(createNumericGoalInputSchema, { ...metadata, domain_key: text(values, "domain_key"), ...definition() });
}
export function measurementFormInput(values: FormData, timeZone: string, editing = false) {
  let measured_at: string | null;
  try { measured_at = dateValue(values, "measured_at", timeZone); }
  catch (error) { return { data: null, errors: { measured_at: (error as Error).message } } as const; }
  if (!measured_at) return { data: null, errors: { measured_at: "Укажите дату и время измерения." } } as const;
  const data = { value: measurementDecimal(text(values, "value")), measured_at, note: nullable(text(values, "note")) };
  return editing ? validate(updateGoalMeasurementInputSchema, data) : validate(createGoalMeasurementInputSchema, { ...data, source: "manual" });
}
