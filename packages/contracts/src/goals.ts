import { z } from "zod";
import { domainKeySchema } from "./domains.ts";

export const GOAL_DECIMAL_INTEGER_DIGITS = 22;
export const GOAL_DECIMAL_SCALE = 8;
export const GOAL_TITLE_MAX_LENGTH = 200;
export const GOAL_DESCRIPTION_MAX_LENGTH = 4000;
export const GOAL_UNIT_LABEL_MAX_LENGTH = 40;
export const GOAL_UNITS = Object.freeze(["NOK", "USD", "count", "minutes", "percent", "custom"] as const);
/** Money units: two decimal places (LFS-218 adds USD); no conversion between currencies. */
export const GOAL_CURRENCY_UNITS = Object.freeze(["NOK", "USD"] as const);
export const GOAL_DIRECTIONS = Object.freeze(["increase", "decrease"] as const);
export const GOAL_STATUSES = Object.freeze(["active", "archived"] as const);
/**
 * Who made the goal (LFS-218): the person (`manual`), the example the person chose to load (`starter`) or the onboarding
 * wizard (`onboarding`, LFS-219). Assigned by the server only; an example becomes `manual` on the first edit or own measurement.
 */
export const GOAL_ORIGINS = Object.freeze(["manual", "starter", "onboarding"] as const);
export const goalUnitSchema = z.enum(GOAL_UNITS);
export const goalDirectionSchema = z.enum(GOAL_DIRECTIONS);
export const goalStatusSchema = z.enum(GOAL_STATUSES);
export const goalOriginSchema = z.enum(GOAL_ORIGINS);
/** Reserved vocabulary; create/stored goals accept manual only until a real metric provider exists. */
export const goalCalculationModeSchema = z.enum(["manual", "computed"]);

/** Exact nonnegative decimal strings, never JSON numbers, exponent notation or implicit rounding. */
export const goalDecimalSchema = z.string()
  .max(GOAL_DECIMAL_INTEGER_DIGITS + GOAL_DECIMAL_SCALE + 1)
  .regex(new RegExp(`^(?:0|[1-9][0-9]{0,${GOAL_DECIMAL_INTEGER_DIGITS - 1}})(?:\\.[0-9]{1,${GOAL_DECIMAL_SCALE}})?$`))
  .transform((value) => value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value);

/** Scale to integer units for exact comparison. Deliberately does not implement goal progress (LFS-207). */
export function goalDecimalToScaledInteger(value: string): bigint {
  const [integer, fraction = ""] = goalDecimalSchema.parse(value).split(".");
  return BigInt(`${integer}${fraction.padEnd(GOAL_DECIMAL_SCALE, "0")}`);
}

/** Shared value policy for a goal definition and its manual measurements; no unit conversion. */
export function goalValueMatchesUnit(value: string, unit: z.infer<typeof goalUnitSchema>): boolean {
  const parsed = goalDecimalSchema.safeParse(value);
  if (!parsed.success) return false;
  const scale = parsed.data.split(".")[1]?.length ?? 0;
  return !((GOAL_CURRENCY_UNITS as readonly string[]).includes(unit) && scale > 2) && !(unit === "count" && scale > 0)
    && !(unit === "percent" && goalDecimalToScaledInteger(parsed.data) > goalDecimalToScaledInteger("100"));
}

/** Finite ISO instant with an explicit offset and millisecond precision at most; canonical output is UTC. */
export const goalInstantSchema = z.iso.datetime({ offset: true }).refine((value) => {
  if (!/(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  // Reject fractions that Date would silently truncate.
  const fraction = value.match(/\.(\d+)/)?.[1];
  if (fraction && fraction.length > 3) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999;
}).transform((value) => new Date(value).toISOString());

const titleSchema = z.string().trim().min(1).max(GOAL_TITLE_MAX_LENGTH);
const descriptionSchema = z.string().trim().min(1).max(GOAL_DESCRIPTION_MAX_LENGTH).nullable();
const definition = {
  domain_key: domainKeySchema,
  title: titleSchema,
  description: descriptionSchema.default(null),
  unit: goalUnitSchema,
  unit_label: z.string().trim().min(1).max(GOAL_UNIT_LABEL_MAX_LENGTH).nullable().default(null),
  baseline: goalDecimalSchema,
  target: goalDecimalSchema,
  direction: goalDirectionSchema,
  calculation_mode: z.literal("manual").default("manual"),
  metric_key: z.null().default(null),
  due_at: goalInstantSchema.nullable().default(null),
};

type NumericDefinition = {
  baseline: string; target: string; direction: z.infer<typeof goalDirectionSchema>;
  unit: z.infer<typeof goalUnitSchema>; unit_label: string | null;
};

function validateDefinition(value: NumericDefinition, context: z.RefinementCtx): void {
  // Other field validation may already have failed; never feed malformed strings into BigInt.
  if (!goalDecimalSchema.safeParse(value.baseline).success || !goalDecimalSchema.safeParse(value.target).success) return;
  const baseline = goalDecimalToScaledInteger(value.baseline);
  const target = goalDecimalToScaledInteger(value.target);
  if (value.direction === "increase" ? target <= baseline : target >= baseline) {
    context.addIssue({ code: "custom", path: ["target"], message: "Target must follow the direction and differ from baseline." });
  }
  if (value.unit === "custom" ? value.unit_label === null : value.unit_label !== null) {
    context.addIssue({ code: "custom", path: ["unit_label"], message: "A unit label is required only for custom units." });
  }
  for (const field of ["baseline", "target"] as const) {
    if (!goalValueMatchesUnit(value[field], value.unit)) {
      context.addIssue({ code: "custom", path: [field], message: "Value is not valid for this unit." });
    }
  }
}

/** Owner, status, identity and timestamps are supplied by the server, never the public input. */
export const createGoalInputSchema = z.strictObject(definition).superRefine(validateDefinition);
export type CreateGoalInput = z.infer<typeof createGoalInputSchema>;

/** The measurable definition of a goal (LFS-217): changeable only while the goal has no measurements. */
export const GOAL_DEFINITION_FIELDS = Object.freeze(["unit", "unit_label", "baseline", "target", "direction"] as const);
export const GOAL_METADATA_FIELDS = Object.freeze(["title", "description", "due_at"] as const);

/**
 * Metadata is always editable. The definition is sent as a whole group (all five fields, `unit_label` may be null) and is
 * validated by the creation rules; a partial definition is rejected. Whether it may change is decided by the server: a goal
 * with measurements keeps its definition (ADR-007), so past measurements are never reinterpreted.
 */
export const updateGoalInputSchema = z.strictObject({
  title: titleSchema.optional(),
  description: descriptionSchema.optional(),
  due_at: goalInstantSchema.nullable().optional(),
  unit: goalUnitSchema.optional(),
  unit_label: z.string().trim().min(1).max(GOAL_UNIT_LABEL_MAX_LENGTH).nullable().optional(),
  baseline: goalDecimalSchema.optional(),
  target: goalDecimalSchema.optional(),
  direction: goalDirectionSchema.optional(),
}).superRefine((input, context) => {
  const missing = GOAL_DEFINITION_FIELDS.filter((field) => input[field] === undefined);
  if (missing.length === GOAL_DEFINITION_FIELDS.length) return;
  if (missing.length > 0) {
    context.addIssue({ code: "custom", path: [missing[0]!], message: "Send the whole goal definition." });
    return;
  }
  validateDefinition(input as NumericDefinition, context);
}).refine((input) => [...GOAL_METADATA_FIELDS, ...GOAL_DEFINITION_FIELDS].some((field) => input[field] !== undefined), { message: "Nothing to update." });
export type UpdateGoalInput = z.infer<typeof updateGoalInputSchema>;

export const goalIdSchema = z.uuid();
export const goalSchema = z.strictObject({
  id: goalIdSchema,
  user_id: z.string().min(1).max(128),
  ...definition,
  // Older clients and fixtures without the field read as the person's own goal; the server always sends it.
  origin: goalOriginSchema.default("manual"),
  status: goalStatusSchema,
  created_at: goalInstantSchema,
  updated_at: goalInstantSchema,
}).superRefine(validateDefinition);
export type Goal = z.infer<typeof goalSchema>;
