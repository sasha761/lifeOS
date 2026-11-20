import type { ActivityEntry, UserPreferences } from "@lifeos/contracts";
import { formatGoalNumber, formatLoggedValue, GOAL_UNIT_LABELS } from "./goal-presentation.ts";
import { formatDate } from "./user-preferences.ts";

const DIRECTION_LABELS = { increase: "увеличить", decrease: "уменьшить" } as const;
const unitName = (unit: keyof typeof GOAL_UNIT_LABELS) => unit === "custom" ? "своя единица" : GOAL_UNIT_LABELS[unit];

/** Parts of a goal edit in reading order; the deadline closes the sentence, as before LFS-217. */
function editParts(entry: ActivityEntry, preferences: Pick<UserPreferences, "timezone" | "locale">): string[] {
  const fields = new Set(entry.changedFields ?? []);
  const number = (value: string) => formatGoalNumber(value, preferences.locale);
  const day = (instant: string | null) => instant === null ? "без срока" : formatDate(new Date(instant), preferences);
  const { before, after } = entry.definition ?? {};
  const parts: string[] = [];
  if (fields.has("title")) parts.push("название изменено");
  if (fields.has("description")) parts.push("описание изменено");
  if (fields.has("unit") && before && after) parts.push(`единица изменена: ${unitName(before.unit)} → ${unitName(after.unit)}`);
  if (fields.has("unit_label")) parts.push("название единицы изменено");
  if (fields.has("baseline") && before && after) parts.push(`старт изменён: ${number(before.baseline)} → ${number(after.baseline)}`);
  if (fields.has("target") && before && after) parts.push(`цель изменена: ${number(before.target)} → ${number(after.target)}`);
  if (fields.has("direction") && before && after) parts.push(`направление изменено: ${DIRECTION_LABELS[before.direction]} → ${DIRECTION_LABELS[after.direction]}`);
  if (entry.dueAt) parts.push(`срок изменён: ${day(entry.dueAt.before)} → ${day(entry.dueAt.after)}`);
  return parts;
}

/**
 * One journal fact as a sentence (mockups 09 «История изменений» and 10 «Последние действия в сфере»). Only what the
 * stored payload proves: titles are current (the log keeps none), a deadline and a definition show their stored values,
 * a correction its previous value. A value entered before the goal's unit changed is a bare number. With `withTitle`
 * the goal is named, as in a sphere-wide list.
 */
export function describeActivity(entry: ActivityEntry, preferences: Pick<UserPreferences, "timezone" | "locale">, { withTitle = false } = {}): string {
  const goal = withTitle ? ` «${entry.goal.title}»` : "";
  const amount = (value: string) => formatLoggedValue(value, entry.measurement!, preferences.locale);
  switch (entry.type) {
    case "goal.created": return `Создана цель${goal}`;
    case "goal.archived": return `Цель${goal} перенесена в архив`;
    case "goal.updated":
      return `${withTitle ? `Цель${goal}: ` : ""}${editParts(entry, preferences).join(", ") || "цель изменена"}`.replace(/^./, (letter) => letter.toUpperCase());
    case "goal_measurement.created": return `Добавлено измерение${goal}: ${amount(entry.measurement!.value)}`;
    case "goal_measurement.deleted": return `Удалено измерение${goal}: ${amount(entry.measurement!.value)}`;
    case "goal_measurement.updated": {
      const { value, previousValue } = entry.measurement!;
      return previousValue !== null && previousValue !== value
        ? `Исправлено измерение${goal}: ${formatGoalNumber(previousValue, preferences.locale)} → ${amount(value)}`
        : `Исправлено измерение${goal}: ${amount(value)}`;
    }
  }
}
