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
const SCALE = 10n ** 8n;
function scaled(value: string): bigint {
  const [integer = "0", fraction = ""] = value.split(".");
  return BigInt(integer) * SCALE + BigInt((fraction + "00000000").slice(0, 8));
}
/**
 * «Осталось» (mockup 09): how far the current value still is from the target, in the goal's unit, computed on exact
 * decimal strings (8 fractional digits, BigInt) and never below zero once the target is reached.
 */
export function remainingToTarget(goal: Pick<Goal, "direction" | "target">, current: string): string {
  const difference = goal.direction === "increase" ? scaled(goal.target) - scaled(current) : scaled(current) - scaled(goal.target);
  const value = difference > 0n ? difference : 0n;
  const fraction = (value % SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  return `${value / SCALE}${fraction ? `.${fraction}` : ""}`;
}
