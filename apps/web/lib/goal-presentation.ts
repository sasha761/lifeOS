import type { Goal, UserPreferences } from "@lifeos/contracts";

export const GOAL_UNIT_LABELS = { NOK: "NOK", count: "шт.", minutes: "мин", percent: "%", custom: "Своя единица" } as const;
/** Only grouping the integer as BigInt; the decimal fraction never passes through Number. */
export function formatGoalNumber(value: string, locale: string): string {
  const [integer = "0", fraction] = value.split(".");
  let formatter: Intl.NumberFormat;
  try { formatter = new Intl.NumberFormat(locale); } catch { formatter = new Intl.NumberFormat("ru"); }
  const decimal = formatter.formatToParts(1.1).find((part) => part.type === "decimal")?.value ?? ",";
  return formatter.format(BigInt(integer)) + (fraction ? decimal + fraction : "");
}
export function goalUnitLabel(goal: Pick<Goal, "unit" | "unit_label">): string {
  return goal.unit === "custom" ? goal.unit_label ?? "" : GOAL_UNIT_LABELS[goal.unit];
}
export function formatGoalValue(value: string, goal: Pick<Goal, "unit" | "unit_label">, locale: string): string {
  return `${formatGoalNumber(value, locale)} ${goalUnitLabel(goal)}`;
}
export function formatGoalPercent(value: number, preferences: UserPreferences): string {
  try { return new Intl.NumberFormat(preferences.locale, { maximumFractionDigits: 2 }).format(value) + "%"; }
  catch { return String(value) + "%"; }
}
