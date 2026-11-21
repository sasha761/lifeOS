import type { Goal, UserPreferences } from "@lifeos/contracts";

/** Unit after a number: «5 000 $», «12 000 NOK» (LFS-218 adds USD). */
export const GOAL_UNIT_LABELS = { NOK: "NOK", USD: "$", count: "шт.", minutes: "мин", percent: "%", custom: "Своя единица" } as const;
/** Choice in the unit select: a currency shows its code, so «$» is not mistaken for another dollar. */
export function goalUnitOptionLabel(unit: keyof typeof GOAL_UNIT_LABELS): string {
  return unit === "USD" ? "USD ($)" : GOAL_UNIT_LABELS[unit];
}
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
/** A journal value: `unit: null` marks a measurement entered before the goal's unit changed (LFS-217), shown as a bare number. */
export function formatLoggedValue(value: string, { unit, unitLabel }: { unit: Goal["unit"] | null; unitLabel: string | null }, locale: string): string {
  return unit === null ? formatGoalNumber(value, locale) : formatGoalValue(value, { unit, unit_label: unitLabel }, locale);
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
