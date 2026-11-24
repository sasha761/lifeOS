import { GOAL_PHASE_LABELS, goalDecimalToScaledInteger, scaledIntegerToGoalDecimal } from "@lifeos/contracts";
import { contributionKind } from "@lifeos/domain";
import type { GoalPhase, GoalProgress, NumericGoal, UserPreferences } from "@lifeos/contracts";

export const MEASUREMENT_MODE_LABELS = { current_value: "Текущее значение", contributions: "Взносы" } as const;

const PAYMENT = { add: "Внести платёж", edit: "Исправить платёж", amount: "Сумма платежа", date: "Дата и время платежа", group: "Платежи", entry: "Платёж", before: "После платежа" };
const DEPOSIT = { add: "Пополнить", edit: "Исправить пополнение", amount: "Сумма пополнения", date: "Дата и время пополнения", group: "Пополнения", entry: "Пополнение", before: "После пополнения" };
export const CONTRIBUTION_LABELS = { payment: PAYMENT, deposit: DEPOSIT } as const;

export function measurementLabels(goal: NumericGoal) {
  const kind = contributionKind(goal);
  if (kind) return CONTRIBUTION_LABELS[kind];
  const unit = goalUnitLabel(goal);
  return { add: "Новое значение", edit: "Исправить измерение", amount: unit === "кг" ? "Вес сейчас" : "Текущее значение",
    date: "Дата и время измерения", group: "Измерения", entry: "Измерение", before: "После сохранения" };
}

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
export function goalUnitLabel(goal: Pick<NumericGoal, "unit" | "unit_label">): string {
  return goal.unit === "custom" ? goal.unit_label ?? "" : GOAL_UNIT_LABELS[goal.unit];
}
export function formatGoalValue(value: string, goal: Pick<NumericGoal, "unit" | "unit_label">, locale: string): string {
  return `${formatGoalNumber(value, locale)} ${goalUnitLabel(goal)}`;
}
/** A journal value: `unit: null` marks a measurement entered before the goal's unit changed (LFS-217), shown as a bare number. */
export function formatLoggedValue(value: string, { unit, unitLabel }: { unit: NumericGoal["unit"] | null; unitLabel: string | null }, locale: string): string {
  return unit === null ? formatGoalNumber(value, locale) : formatGoalValue(value, { unit, unit_label: unitLabel }, locale);
}
/** Chip tones of the phases (LFS-225, mockups 32–36): planned neutral, in progress amber, paused blue, achieved green. */
export const PHASE_TONES = { planned: "neutral", in_progress: "amber", paused: "blue", achieved: "green" } as const;
/** «✓ Достигнута» carries its mark; the other phases are their plain words. */
export function phaseLabel(phase: GoalPhase): string {
  return phase === "achieved" ? `✓ ${GOAL_PHASE_LABELS.achieved}` : GOAL_PHASE_LABELS[phase];
}
export function formatGoalPercent(value: number, preferences: UserPreferences): string {
  try { return new Intl.NumberFormat(preferences.locale, { maximumFractionDigits: 2 }).format(value) + "%"; }
  catch { return String(value) + "%"; }
}
export function formatProgressAmount(goal: NumericGoal, progress: Pick<GoalProgress, "current" | "contributionTotal">, locale: string, full = false): string {
  const { current, contributionTotal } = progress;
  if (current === null) return "";
  const amount = (value: string) => formatGoalValue(value, goal, locale);
  const number = (value: string) => formatGoalNumber(value, locale);
  const kind = contributionKind(goal);
  if (kind === "payment" && contributionTotal !== undefined) {
    const planned = scaledIntegerToGoalDecimal(goalDecimalToScaledInteger(goal.baseline) - goalDecimalToScaledInteger(goal.target));
    const paid = `выплачено ${number(contributionTotal)} из ${amount(planned)}`;
    return full ? `${paid} · осталось ${amount(remainingToTarget(goal, current))}` : paid;
  }
  if (kind === "deposit") return `накоплено ${number(current)} из ${amount(goal.target)}`;
  return goal.direction === "decrease"
    ? `сейчас ${amount(current)} · цель ${amount(goal.target)}`
    : `${full ? amount(current) : number(current)} из ${amount(goal.target)}`;
}

const scaled = goalDecimalToScaledInteger;
/**
 * «Осталось» (mockup 09): how far the current value still is from the target, in the goal's unit, computed on exact
 * decimal strings (8 fractional digits, BigInt) and never below zero once the target is reached.
 */
export function remainingToTarget(goal: Pick<NumericGoal, "direction" | "target">, current: string): string {
  const difference = goal.direction === "increase" ? scaled(goal.target) - scaled(current) : scaled(current) - scaled(goal.target);
  return scaledIntegerToGoalDecimal(difference > 0n ? difference : 0n);
}
