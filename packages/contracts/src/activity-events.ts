import { z } from "zod";
import { domainKeySchema } from "./domains.ts";
import { goalMeasurementSourceSchema } from "./goal-measurements.ts";
import { goalDecimalSchema, goalDirectionSchema, goalIdSchema, goalInstantSchema, goalKindSchema, goalPhaseSchema, goalStatusSchema, goalUnitSchema } from "./goals.ts";
import { idempotencyKeySchema } from "./idempotency.ts";

export const ACTIVITY_EVENT_TYPES = Object.freeze([
  "goal.created", "goal.updated", "goal.archived",
  "goal_measurement.created", "goal_measurement.updated", "goal_measurement.deleted",
] as const);
/** `starter`: facts written by loading the example the person chose (LFS-218). */
export const ACTIVITY_SOURCES = Object.freeze(["manual", "web", "telegram", "import", "ai_proposed", "starter"] as const);
export const activitySourceSchema = z.enum(ACTIVITY_SOURCES);
export const activeActivitySourceSchema = z.enum(["manual", "web"]);
/** Server transport context, separate from the request body; keys are required even for no-ops. */
export const goalCommandOptionsSchema = z.strictObject({ idempotencyKey: idempotencyKeySchema, source: activeActivitySourceSchema });
export type GoalCommandOptions = z.infer<typeof goalCommandOptionsSchema>;
/** Sources an audit writer may stamp: the transport sources plus `starter`, which only the example command uses. */
export const activityWriterContextSchema = z.strictObject({ idempotencyKey: idempotencyKeySchema, source: z.enum(["manual", "web", "starter"]) });
export type ActivityWriterContext = z.infer<typeof activityWriterContextSchema>;

/**
 * No free text, identity, credentials or request bodies in audit snapshots. The definition is null for a goal without
 * measurements; `kind`, `phase` and `starts_at` (LFS-225) are absent from events written before them.
 */
export const goalAuditSnapshotSchema = z.strictObject({
  unit: goalUnitSchema.nullable(), baseline: goalDecimalSchema.nullable(), target: goalDecimalSchema.nullable(),
  direction: goalDirectionSchema.nullable(), status: goalStatusSchema, due_at: goalInstantSchema.nullable(),
  kind: goalKindSchema.optional(), phase: goalPhaseSchema.optional(), starts_at: goalInstantSchema.nullable().optional(),
});
export const GOAL_AUDIT_FIELDS = Object.freeze(["unit", "baseline", "target", "direction", "status", "due_at", "kind", "phase", "starts_at"] as const);
export const MEASUREMENT_AUDIT_FIELDS = Object.freeze(["value", "measured_at", "source"] as const);
const measurementSnapshotSchema = z.strictObject({ value: goalDecimalSchema, measured_at: goalInstantSchema, source: goalMeasurementSourceSchema });
/**
 * goal.updated: which fields changed. Text fields are named only; definition values are in the before/after snapshots.
 * `origin` (LFS-218) marks an example becoming the person's own goal; the snapshots hold no origin. `starts_at` and
 * `phase` (LFS-225) have their values in the snapshots; a phase change is a command of its own.
 */
export const GOAL_CHANGED_FIELDS = Object.freeze(["title", "description", "due_at", "unit", "unit_label", "baseline", "target", "direction", "origin", "starts_at", "phase"] as const);
export const goalChangedFieldSchema = z.enum(GOAL_CHANGED_FIELDS);
const changedFieldsSchema = z.array(goalChangedFieldSchema).min(1).max(GOAL_CHANGED_FIELDS.length).refine((fields) => new Set(fields).size === fields.length);
const base = { goal_id: goalIdSchema, domain_key: domainKeySchema, target_id: goalIdSchema, schema_version: z.literal(1) };
export const activityEventDraftSchema = z.discriminatedUnion("event_type", [
  z.strictObject({ ...base, event_type: z.literal("goal.created"), target_type: z.literal("goal"), payload: z.strictObject({ before: z.null(), after: goalAuditSnapshotSchema }) }),
  z.strictObject({ ...base, event_type: z.literal("goal.updated"), target_type: z.literal("goal"), payload: z.strictObject({ before: goalAuditSnapshotSchema, after: goalAuditSnapshotSchema, changed_fields: changedFieldsSchema }) }),
  z.strictObject({ ...base, event_type: z.literal("goal.archived"), target_type: z.literal("goal"), payload: z.strictObject({ before: goalAuditSnapshotSchema, after: goalAuditSnapshotSchema }) }),
  z.strictObject({ ...base, event_type: z.literal("goal_measurement.created"), target_type: z.literal("goal_measurement"), payload: z.strictObject({ before: z.null(), after: measurementSnapshotSchema }) }),
  z.strictObject({ ...base, event_type: z.literal("goal_measurement.updated"), target_type: z.literal("goal_measurement"), payload: z.strictObject({ before: measurementSnapshotSchema, after: measurementSnapshotSchema,
    changed_fields: z.array(z.enum(["value", "measured_at", "note"])).min(1).max(3).refine((fields) => new Set(fields).size === fields.length).optional() }) }),
  z.strictObject({ ...base, event_type: z.literal("goal_measurement.deleted"), target_type: z.literal("goal_measurement"), payload: z.strictObject({ before: measurementSnapshotSchema, after: z.null() }) }),
]).superRefine((event, context) => {
  if (event.target_type === "goal" && event.target_id !== event.goal_id) context.addIssue({ code: "custom", path: ["target_id"], message: "Goal target mismatch." });
  if (event.event_type === "goal.created" && event.payload.after.status !== "active") context.addIssue({ code: "custom", path: ["payload"], message: "New goal must be active." });
  if (event.event_type === "goal.archived" && (event.payload.before.status !== "active" || event.payload.after.status !== "archived")) context.addIssue({ code: "custom", path: ["payload"], message: "Invalid archive transition." });
  if (event.event_type === "goal.updated" && event.payload.changed_fields.includes("phase")
    && (event.payload.changed_fields.length !== 1 || !event.payload.before.phase || !event.payload.after.phase || event.payload.before.phase === event.payload.after.phase)) {
    context.addIssue({ code: "custom", path: ["payload"], message: "A phase change is its own event with both phases." });
  }
});
export type ActivityEventDraft = z.infer<typeof activityEventDraftSchema>;
export const activityEventMetadataSchema = z.strictObject({
  id: z.uuid(), user_id: z.string().min(1).max(128), source: activitySourceSchema,
  idempotency_key: idempotencyKeySchema.nullable(), occurred_at: goalInstantSchema, created_at: goalInstantSchema,
});
export type ActivityEvent = ActivityEventDraft & z.infer<typeof activityEventMetadataSchema>;
