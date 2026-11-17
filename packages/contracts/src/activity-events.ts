import { z } from "zod";
import { domainKeySchema } from "./domains.ts";
import { goalDecimalSchema, goalDirectionSchema, goalIdSchema, goalInstantSchema, goalStatusSchema, goalUnitSchema } from "./goals.ts";
import { idempotencyKeySchema } from "./idempotency.ts";

export const ACTIVITY_EVENT_TYPES = Object.freeze([
  "goal.created", "goal.updated", "goal.archived",
  "goal_measurement.created", "goal_measurement.updated", "goal_measurement.deleted",
] as const);
export const ACTIVITY_SOURCES = Object.freeze(["manual", "web", "telegram", "import", "ai_proposed"] as const);
export const activitySourceSchema = z.enum(ACTIVITY_SOURCES);
export const activeActivitySourceSchema = z.enum(["manual", "web"]);
/** Server transport context, separate from the request body; keys are required even for no-ops. */
export const goalCommandOptionsSchema = z.strictObject({ idempotencyKey: idempotencyKeySchema, source: activeActivitySourceSchema });
export type GoalCommandOptions = z.infer<typeof goalCommandOptionsSchema>;

// No free text, identity, credentials or request bodies in audit snapshots.
export const goalAuditSnapshotSchema = z.strictObject({
  unit: goalUnitSchema, baseline: goalDecimalSchema, target: goalDecimalSchema,
  direction: goalDirectionSchema, status: goalStatusSchema, due_at: goalInstantSchema.nullable(),
});
export const GOAL_AUDIT_FIELDS = Object.freeze(["unit", "baseline", "target", "direction", "status", "due_at"] as const);
export const MEASUREMENT_AUDIT_FIELDS = Object.freeze(["value", "measured_at", "source"] as const);
const measurementSnapshotSchema = z.strictObject({ value: goalDecimalSchema, measured_at: goalInstantSchema, source: z.literal("manual") });
const changedFieldsSchema = z.array(z.enum(["title", "description", "due_at"])).min(1).max(3).refine((fields) => new Set(fields).size === fields.length);
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
});
export type ActivityEventDraft = z.infer<typeof activityEventDraftSchema>;
export const activityEventMetadataSchema = z.strictObject({
  id: z.uuid(), user_id: z.string().min(1).max(128), source: activitySourceSchema,
  idempotency_key: idempotencyKeySchema.nullable(), occurred_at: goalInstantSchema, created_at: goalInstantSchema,
});
export type ActivityEvent = ActivityEventDraft & z.infer<typeof activityEventMetadataSchema>;
