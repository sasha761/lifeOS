import { z } from "zod";
import { ACTIVITY_EVENT_TYPES, activitySourceSchema } from "./activity-events.ts";
import { DOMAIN_KEYS, domainKeySchema } from "./domains.ts";
import {
  GOAL_TITLE_MAX_LENGTH, GOAL_UNIT_LABEL_MAX_LENGTH, goalDecimalSchema, goalIdSchema, goalInstantSchema, goalStatusSchema, goalUnitSchema,
} from "./goals.ts";
import { goalDetailsSchema } from "./goals-api.ts";

/** Bounded read model: newest active goals per sphere, nearest deadlines and newest audit facts. */
export const DASHBOARD_GOALS_PER_DOMAIN = 5;
export const DASHBOARD_DUE_GOALS_LIMIT = 8;
export const DASHBOARD_ACTIVITY_LIMIT = 10;

const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ordered = (values: readonly string[], direction: "asc" | "desc") =>
  values.every((value, index) => index === 0 || (direction === "asc" ? values[index - 1]! <= value : values[index - 1]! >= value));

/**
 * One sphere of the registry. Counts are exact; `goals` holds the newest active goals with the same
 * GoalDetails DTO as GET /api/v1/goals/:id. There is no aggregate sphere percentage or "life score".
 */
export const dashboardDomainSchema = z.strictObject({
  key: domainKeySchema,
  activeCount: countSchema,
  archivedCount: countSchema,
  goals: z.array(goalDetailsSchema).max(DASHBOARD_GOALS_PER_DOMAIN),
}).refine((domain) => domain.goals.length <= domain.activeCount
  && domain.goals.every(({ goal }) => goal.domain_key === domain.key && goal.status === "active"));
export type DashboardDomain = z.infer<typeof dashboardDomainSchema>;

/** Normalized audit fact: type, UTC time and source; measurement facts carry only the snapshot value. */
export const dashboardActivitySchema = z.strictObject({
  id: z.uuid(),
  type: z.enum(ACTIVITY_EVENT_TYPES),
  occurredAt: goalInstantSchema,
  source: activitySourceSchema,
  domainKey: domainKeySchema,
  /** Current goal metadata: the audit log deliberately stores no titles (ADR-008). */
  goal: z.strictObject({ id: goalIdSchema, title: z.string().min(1).max(GOAL_TITLE_MAX_LENGTH), status: goalStatusSchema }),
  measurement: z.strictObject({
    /** null for a measurement recorded before the goal's unit last changed (LFS-217): shown as a plain number. */
    value: goalDecimalSchema, unit: goalUnitSchema.nullable(), unitLabel: z.string().min(1).max(GOAL_UNIT_LABEL_MAX_LENGTH).nullable(),
  }).refine((measurement) => measurement.unit !== null || measurement.unitLabel === null).nullable(),
  /** As in the journal (LFS-218): a fact of the example, labelled «Пример». */
  example: z.boolean(),
}).refine((item) => item.type.startsWith("goal_measurement.") === (item.measurement !== null));
export type DashboardActivity = z.infer<typeof dashboardActivitySchema>;

export const dashboardSchema = z.strictObject({
  /** Always the six registry spheres in registry order, including empty ones. */
  domains: z.array(dashboardDomainSchema).length(DOMAIN_KEYS.length)
    .refine((domains) => domains.every((domain, index) => domain.key === DOMAIN_KEYS[index])),
  today: z.strictObject({
    /** Active goals with a deadline, nearest (including overdue) first. */
    dueGoals: z.array(goalDetailsSchema).max(DASHBOARD_DUE_GOALS_LIMIT)
      .refine((items) => items.every(({ goal }) => goal.status === "active" && goal.due_at !== null)
        && ordered(items.map(({ goal }) => goal.due_at!), "asc")),
  }),
  /** Newest first. */
  activity: z.array(dashboardActivitySchema).max(DASHBOARD_ACTIVITY_LIMIT)
    .refine((items) => ordered(items.map((item) => item.occurredAt), "desc")),
  /**
   * The example in the account (LFS-218): goals still labelled «Пример» (active and archived) and example measurements,
   * for the banner and «Удалить все примеры». Two counts of owned rows, no query per goal.
   */
  examples: z.strictObject({ goals: countSchema, measurements: countSchema }),
});
export type Dashboard = z.infer<typeof dashboardSchema>;
