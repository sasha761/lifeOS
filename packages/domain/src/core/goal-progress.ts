import { goalDecimalToScaledInteger, goalProgressInputSchema } from "@lifeos/contracts";
import type { ProgressComputation } from "@lifeos/contracts";
import { InvalidInputError } from "./errors.ts";

/** Exact scaled integers for amounts; only the bounded, two-decimal display percent becomes Number. */
export function calculateGoalProgress(input: unknown): ProgressComputation {
  const parsed = goalProgressInputSchema.safeParse(input);
  if (!parsed.success) throw new InvalidInputError();
  const { baseline, target, current, direction } = parsed.data;
  if (current === null) return { status: "insufficient_data", progressPercent: null, explanation: "Недостаточно данных" };
  const base = goalDecimalToScaledInteger(baseline);
  const end = goalDecimalToScaledInteger(target);
  const value = goalDecimalToScaledInteger(current);
  const denominator = direction === "increase" ? end - base : base - end;
  if (denominator <= 0n) return { status: "invalid_definition", progressPercent: null, explanation: "Некорректное определение цели" };
  const numerator = direction === "increase" ? value - base : base - value;
  const hundredths = numerator <= 0n ? 0n : numerator >= denominator ? 10_000n
    : (numerator * 10_000n + denominator / 2n) / denominator;
  return { status: "measured", progressPercent: Number(hundredths) / 100, explanation: null };
}
