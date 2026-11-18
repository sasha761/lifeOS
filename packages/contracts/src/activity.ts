import { z } from "zod";
import { ACTIVITY_EVENT_TYPES, activitySourceSchema } from "./activity-events.ts";
import { domainKeySchema } from "./domains.ts";
import {
  GOAL_TITLE_MAX_LENGTH, GOAL_UNIT_LABEL_MAX_LENGTH, goalDecimalSchema, goalIdSchema, goalInstantSchema, goalStatusSchema, goalUnitSchema,
} from "./goals.ts";

/** GET /api/v1/activity (LFS-213): the owner's audit journal, newest first, bounded; no cursor yet. */
export const ACTIVITY_LIMIT_DEFAULT = 10;
export const ACTIVITY_LIMIT_MAX = 50;
const limitSchema = z.union([z.number(), z.string().regex(/^[1-9][0-9]?$/).transform(Number)])
  .pipe(z.number().int().min(1).max(ACTIVITY_LIMIT_MAX)).default(ACTIVITY_LIMIT_DEFAULT);

/** At most one filter: one sphere (`domain_key`) or one goal (`goal_id`). Unknown keys, such as `user_id`, are rejected. */
export const activityQuerySchema = z.strictObject({
  limit: limitSchema,
  domain_key: domainKeySchema.optional(),
  goal_id: goalIdSchema.transform((id) => id.toLowerCase()).optional(),
}).refine((query) => query.domain_key === undefined || query.goal_id === undefined, { path: ["goal_id"], message: "Use one filter." });
export type ActivityQuery = z.infer<typeof activityQuerySchema>;

const goalChangedFieldSchema = z.enum(["title", "description", "due_at"]);

/**
 * One audit fact for people: type, UTC time, source, the current goal title (the log stores none, ADR-008) and only
 * what the stored payload proves. `changedFields`/`dueAt` describe goal edits; `previousValue` a corrected measurement.
 */
export const activityEntrySchema = z.strictObject({
  id: z.uuid(),
  type: z.enum(ACTIVITY_EVENT_TYPES),
  occurredAt: goalInstantSchema,
  source: activitySourceSchema,
  domainKey: domainKeySchema,
  goal: z.strictObject({ id: goalIdSchema, title: z.string().min(1).max(GOAL_TITLE_MAX_LENGTH), status: goalStatusSchema }),
  measurement: z.strictObject({
    value: goalDecimalSchema, previousValue: goalDecimalSchema.nullable(),
    unit: goalUnitSchema, unitLabel: z.string().min(1).max(GOAL_UNIT_LABEL_MAX_LENGTH).nullable(),
  }).nullable(),
  changedFields: z.array(goalChangedFieldSchema).min(1).max(3).nullable(),
  dueAt: z.strictObject({ before: goalInstantSchema.nullable(), after: goalInstantSchema.nullable() }).nullable(),
}).refine((item) => item.type.startsWith("goal_measurement.") === (item.measurement !== null))
  .refine((item) => (item.type === "goal_measurement.updated") === (item.measurement?.previousValue != null))
  .refine((item) => (item.type === "goal.updated") === (item.changedFields !== null))
  .refine((item) => (item.dueAt !== null) === (item.changedFields?.includes("due_at") ?? false));
export type ActivityEntry = z.infer<typeof activityEntrySchema>;

export const activityFeedSchema = z.strictObject({
  /** Newest first, at most the requested limit. */
  items: z.array(activityEntrySchema).max(ACTIVITY_LIMIT_MAX)
    .refine((items) => items.every((item, index) => index === 0 || items[index - 1]!.occurredAt >= item.occurredAt)),
});
export type ActivityFeed = z.infer<typeof activityFeedSchema>;
