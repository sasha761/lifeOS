import type { Dashboard, DashboardActivity } from "@lifeos/contracts";

const ACTIVITY_LABELS = {
  "goal.created": "Создана цель",
  "goal.updated": "Изменена цель",
  "goal.archived": "Цель перенесена в архив",
  "goal_measurement.created": "Добавлено измерение",
  "goal_measurement.updated": "Исправлено измерение",
  "goal_measurement.deleted": "Удалено измерение",
} as const satisfies Record<DashboardActivity["type"], string>;
const SOURCE_LABELS = {
  web: "веб", manual: "вручную", telegram: "Telegram", import: "импорт", ai_proposed: "предложение ассистента",
} as const satisfies Record<DashboardActivity["source"], string>;

export function activityLabel(type: DashboardActivity["type"]): string { return ACTIVITY_LABELS[type]; }
export function sourceLabel(source: DashboardActivity["source"]): string { return SOURCE_LABELS[source]; }

/** Russian plural form: 1 цель, 2 цели, 5 целей, 11 целей, 21 цель. */
export function plural(count: number, forms: readonly [one: string, few: string, many: string]): string {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return forms[2];
  if (units === 1) return forms[0];
  if (units >= 2 && units <= 4) return forms[1];
  return forms[2];
}

/** YYYY-MM-DD of an instant in the account time zone. */
export function calendarDay(instant: Date, timeZone: string): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant); }
  catch { return instant.toISOString().slice(0, 10); }
}

/** Deadline state in the account time zone: past moment, later today, or a later day. */
export function dueState(dueAt: string, now: Date, timeZone: string): "overdue" | "today" | "upcoming" {
  const due = new Date(dueAt);
  if (due.getTime() < now.getTime()) return "overdue";
  return calendarDay(due, timeZone) === calendarDay(now, timeZone) ? "today" : "upcoming";
}

/** Exact counts only; no percentages or scores across spheres. */
export function dashboardTotals(dashboard: Dashboard) {
  const active = dashboard.domains.reduce((sum, domain) => sum + domain.activeCount, 0);
  const archived = dashboard.domains.reduce((sum, domain) => sum + domain.archivedCount, 0);
  const spheres = dashboard.domains.filter((domain) => domain.activeCount > 0).length;
  return { active, archived, spheres };
}

/** Weekday and date of an instant in the account zone and locale, without a time. */
export function formatDay(instant: Date, preferences: { timezone: string; locale: string }): string {
  const options = { weekday: "short", day: "numeric", month: "long" } as const;
  try { return new Intl.DateTimeFormat(preferences.locale, { ...options, timeZone: preferences.timezone }).format(instant); }
  catch { return new Intl.DateTimeFormat("ru", { ...options, timeZone: "UTC" }).format(instant); }
}

/** Whole calendar days from today to the deadline in the account zone: 0 today, negative once it has passed. */
export function daysUntil(dueAt: string, now: Date, timeZone: string): number {
  const day = (value: Date) => Date.parse(`${calendarDay(value, timeZone)}T00:00:00Z`);
  return Math.round((day(new Date(dueAt)) - day(now)) / 86_400_000);
}
/** «44 дня», «сегодня», «срок прошёл» for the «Осталось» tile. */
export function formatDaysLeft(days: number): string {
  if (days === 0) return "сегодня";
  if (days < 0) return "срок прошёл";
  return `${days} ${plural(days, ["день", "дня", "дней"])}`;
}
