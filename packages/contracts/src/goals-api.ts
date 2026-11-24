import { z } from "zod";
import { domainKeySchema } from "./domains.ts";
import {
  GOAL_PHASE_LABELS, goalAggregateDecimalSchema, goalDecimalSchema, goalDirectionSchema, goalIdSchema, goalInstantSchema, goalSchema, goalStatusSchema, goalUnitSchema,
  setGoalPhaseInputSchema, updateGoalInputSchema,
} from "./goals.ts";
import { goalMeasurementSchema } from "./goal-measurements.ts";

export const goalDeletionSchema = z.strictObject({ id: goalIdSchema, user_id: z.string().min(1).max(128), deleted: z.literal(true) });
export type GoalDeletion = z.infer<typeof goalDeletionSchema>;

export const GOALS_PAGE_DEFAULT = 20;
export const GOALS_PAGE_MAX = 100;
const limitSchema = z.union([z.number(), z.string().regex(/^[1-9][0-9]{0,2}$/).transform(Number)])
  .pipe(z.number().int().min(1).max(GOALS_PAGE_MAX)).default(GOALS_PAGE_DEFAULT);
const goalCursorSchema = z.strictObject({ created_at: goalInstantSchema, id: goalIdSchema,
  domain_key: domainKeySchema.nullable(), status: goalStatusSchema.nullable() });
const measurementCursorSchema = z.strictObject({ goal_id: goalIdSchema, measured_at: goalInstantSchema, created_at: goalInstantSchema, id: goalIdSchema });
export type GoalsCursor = z.infer<typeof goalCursorSchema>;
export type MeasurementsCursor = z.infer<typeof measurementCursorSchema>;
/** Versioned seek positions, not authorization tokens. Queries always retain actor ownership. */
export function decodeGoalsCursor(token: string): GoalsCursor | null {
  const [version, domain_key, status, created_at, id, ...rest] = token.split("!");
  if (version !== "g1" || rest.length) return null;
  const parsed = goalCursorSchema.safeParse({ domain_key: domain_key === "all" ? null : domain_key, status: status === "all" ? null : status, created_at, id });
  return parsed.success ? { ...parsed.data, id: parsed.data.id.toLowerCase() } : null;
}
export function encodeGoalsCursor(value: GoalsCursor): string {
  const parsed = goalCursorSchema.parse(value);
  return ["g1", parsed.domain_key ?? "all", parsed.status ?? "all", parsed.created_at, parsed.id.toLowerCase()].join("!");
}
export function decodeMeasurementsCursor(token: string): MeasurementsCursor | null {
  const [version, goal_id, measured_at, created_at, id, ...rest] = token.split("!");
  if (version !== "m1" || rest.length) return null;
  const parsed = measurementCursorSchema.safeParse({ goal_id, measured_at, created_at, id });
  return parsed.success ? { ...parsed.data, goal_id: parsed.data.goal_id.toLowerCase(), id: parsed.data.id.toLowerCase() } : null;
}
export function encodeMeasurementsCursor(value: MeasurementsCursor): string {
  const parsed = measurementCursorSchema.parse(value);
  return ["m1", parsed.goal_id.toLowerCase(), parsed.measured_at, parsed.created_at, parsed.id.toLowerCase()].join("!");
}
const goalsCursorToken = z.string().max(512).refine((value) => decodeGoalsCursor(value) !== null);
const measurementsCursorToken = z.string().max(512).refine((value) => decodeMeasurementsCursor(value) !== null);
export const goalsListQuerySchema = z.strictObject({ limit: limitSchema, cursor: goalsCursorToken.optional(), domain_key: domainKeySchema.optional(), status: goalStatusSchema.optional() });
export type GoalsListQuery = z.infer<typeof goalsListQuerySchema>;
export const measurementsListQuerySchema = z.strictObject({ limit: limitSchema, cursor: measurementsCursorToken.optional() });
export type MeasurementsListQuery = z.infer<typeof measurementsListQuerySchema>;

// Archiving and a phase change (LFS-225) are separate commands: mixing either with metadata edits is rejected atomically.
export const patchGoalInputSchema = z.union([updateGoalInputSchema, z.strictObject({ status: z.literal("archived") }), setGoalPhaseInputSchema]);
export type PatchGoalInput = z.infer<typeof patchGoalInputSchema>;
export const goalProgressInputSchema = z.strictObject({ baseline: goalDecimalSchema, target: goalDecimalSchema,
  current: goalAggregateDecimalSchema.nullable(), direction: goalDirectionSchema });
export type GoalProgressInput = z.infer<typeof goalProgressInputSchema>;
type PhaseLabel = (typeof GOAL_PHASE_LABELS)[keyof typeof GOAL_PHASE_LABELS];
const PHASE_LABELS = Object.values(GOAL_PHASE_LABELS) as [PhaseLabel, ...PhaseLabel[]];
const phaseLabelSchema = z.enum(PHASE_LABELS);
export const progressComputationSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("measured"), progressPercent: z.number().min(0).max(100), explanation: z.null() }),
  z.strictObject({ status: z.literal("insufficient_data"), progressPercent: z.null(), explanation: z.literal("Недостаточно данных") }),
  z.strictObject({ status: z.literal("invalid_definition"), progressPercent: z.null(), explanation: z.literal("Некорректное определение цели") }),
  // LFS-225 (ADR-013): a goal without measurements has no percentage; the explanation is its phase in words.
  z.strictObject({ status: z.literal("unmeasured"), progressPercent: z.null(), explanation: phaseLabelSchema }),
]);
export type ProgressComputation = z.infer<typeof progressComputationSchema>;
const provenanceFields = { measurementId: goalIdSchema, measuredAt: goalInstantSchema, recordedAt: goalInstantSchema, updatedAt: goalInstantSchema };
/** Where the current value comes from: the person's own entry, or an example measurement (LFS-218) that is not their data. */
const provenanceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("self_report"), source: z.literal("manual"), ...provenanceFields }),
  z.strictObject({ kind: z.literal("example"), source: z.literal("example"), ...provenanceFields }),
]);
/**
 * A goal without measurements (`status: unmeasured`, LFS-225) has no methodology, unit, start, target, current or
 * provenance: everything numeric is null and the explanation names its phase.
 */
export const goalProgressSchema = z.strictObject({
  methodology: z.strictObject({ version: z.literal(1), mode: z.literal("manual"),
    formula: z.enum(["(current-baseline)/(target-baseline)", "(baseline-current)/(baseline-target)"]),
    percentDecimals: z.literal(2), rounding: z.literal("half_up"), clamped: z.literal(true) }).nullable(),
  source: z.literal("manual"), provenance: provenanceSchema.nullable(), unit: goalUnitSchema.nullable(),
  baseline: goalDecimalSchema.nullable(), target: goalDecimalSchema.nullable(), current: goalAggregateDecimalSchema.nullable(),
  status: z.enum(["measured", "insufficient_data", "invalid_definition", "unmeasured"]), progressPercent: z.number().min(0).max(100).nullable(),
  explanation: z.enum(["Недостаточно данных", "Некорректное определение цели", ...PHASE_LABELS]).nullable(),
  contributionTotal: goalAggregateDecimalSchema.optional(),
  measurementModeLocked: z.literal(true).optional(),
  updatedAt: goalInstantSchema, measurementCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).refine((value) => value.status === "unmeasured"
  ? value.methodology === null && value.unit === null && value.baseline === null && value.target === null
  : value.methodology !== null && value.unit !== null && value.baseline !== null && value.target !== null)
  .refine((value) => value.current === null
    ? value.provenance === null && value.measurementCount === 0 && (value.status === "insufficient_data" || value.status === "unmeasured")
    : value.provenance !== null && value.measurementCount > 0 && value.status !== "insufficient_data" && value.status !== "unmeasured")
  .refine((value) => progressComputationSchema.safeParse({ status: value.status, progressPercent: value.progressPercent, explanation: value.explanation }).success);
export type GoalProgress = z.infer<typeof goalProgressSchema>;
export const goalDetailsSchema = z.strictObject({ goal: goalSchema, progress: goalProgressSchema })
  .refine(({ goal, progress }) => goal.unit === progress.unit && goal.baseline === progress.baseline && goal.target === progress.target
    && (goal.kind === "unmeasured") === (progress.status === "unmeasured")
    && (goal.kind === "numeric" || progress.explanation === GOAL_PHASE_LABELS[goal.phase])
    && (progress.contributionTotal !== undefined) === (goal.measurement_mode === "contributions" && progress.current !== null));
export type GoalDetails = z.infer<typeof goalDetailsSchema>;
export const goalsPageSchema = z.strictObject({ items: z.array(goalDetailsSchema).max(GOALS_PAGE_MAX), nextCursor: goalsCursorToken.nullable() });
export type GoalsPage = z.infer<typeof goalsPageSchema>;
export const measurementsPageSchema = z.strictObject({ items: z.array(goalMeasurementSchema).max(GOALS_PAGE_MAX), nextCursor: measurementsCursorToken.nullable(),
  measurementCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) });
export type MeasurementsPage = z.infer<typeof measurementsPageSchema>;
