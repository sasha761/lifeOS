import type { ActivityEntry, UserPreferences } from "@lifeos/contracts";
import { formatGoalNumber, formatGoalValue } from "./goal-presentation.ts";
import { formatDate } from "./user-preferences.ts";

const FIELD_LABELS = { title: "название", description: "описание", due_at: "срок" } as const;

/**
 * One journal fact as a sentence (mockups 09 «История изменений» and 10 «Последние действия в сфере»). Only what the
 * stored payload proves: titles are current (the log keeps none), a deadline shows its stored dates, a correction
 * its previous value. With `withTitle` the goal is named, as in a sphere-wide list.
 */
export function describeActivity(entry: ActivityEntry, preferences: Pick<UserPreferences, "timezone" | "locale">, { withTitle = false } = {}): string {
  const goal = withTitle ? ` «${entry.goal.title}»` : "";
  const unit = entry.measurement && { unit: entry.measurement.unit, unit_label: entry.measurement.unitLabel };
  const amount = (value: string) => formatGoalValue(value, unit!, preferences.locale);
  const day = (instant: string | null) => instant === null ? "без срока" : formatDate(new Date(instant), preferences);
  switch (entry.type) {
    case "goal.created": return `Создана цель${goal}`;
    case "goal.archived": return `Цель${goal} перенесена в архив`;
    case "goal.updated": {
      const parts = (entry.changedFields ?? []).filter((field) => field !== "due_at").map((field) => `${FIELD_LABELS[field]} изменено`);
      if (entry.dueAt) parts.push(`срок изменён: ${day(entry.dueAt.before)} → ${day(entry.dueAt.after)}`);
      return `${withTitle ? `Цель${goal}: ` : ""}${parts.join(", ") || "цель изменена"}`.replace(/^./, (letter) => letter.toUpperCase());
    }
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
