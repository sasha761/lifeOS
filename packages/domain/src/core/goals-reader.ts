import {
  decodeGoalsCursor, decodeMeasurementsCursor, encodeGoalsCursor, encodeMeasurementsCursor,
  goalIdSchema, goalsListQuerySchema, measurementsListQuerySchema,
} from "@lifeos/contracts";
import type {
  Goal, GoalDetails, GoalMeasurement, GoalsCursor, GoalsListQuery, GoalsPage, MeasurementsCursor, MeasurementsPage,
} from "@lifeos/contracts";
import type { Actor } from "./actor.ts";
import { calculateGoalProgress } from "./goal-progress.ts";
import { InvalidInputError, NotFoundError } from "./errors.ts";
import { requireFound, requireOwned } from "./ownership.ts";

export type GoalReadRecord = { goal: Goal; latest: GoalMeasurement | null; measurementCount: number; updatedAt: string };
export type GoalsReadQuery = Pick<GoalsListQuery, "limit" | "domain_key" | "status"> & { after?: GoalsCursor };
export type MeasurementsReadQuery = { limit: number; after?: MeasurementsCursor };
/** Each method returns a consistent read snapshot; page methods fetch limit+1 for continuation. */
export type GoalsReadRepository = {
  find(actor: Actor, id: string): Promise<GoalReadRecord | null>;
  list(actor: Actor, query: GoalsReadQuery): Promise<GoalReadRecord[]>;
  history(actor: Actor, goalId: string, query: MeasurementsReadQuery): Promise<{ goal: Goal; items: GoalMeasurement[]; measurementCount: number } | null>;
};
export type GoalsReader = {
  get(actor: Actor, id: unknown): Promise<GoalDetails>;
  list(actor: Actor, query: unknown): Promise<GoalsPage>;
  history(actor: Actor, goalId: unknown, query: unknown): Promise<MeasurementsPage>;
};
function identifier(value: unknown) {
  const parsed = goalIdSchema.safeParse(value);
  if (!parsed.success) throw new NotFoundError();
  return parsed.data.toLowerCase();
}
function owned(actor: Actor, goal: Goal): void { requireOwned(actor, { userId: goal.user_id }); }
/** Shared by the goals reader and the dashboard, so both expose identical progress for a goal. */
export function goalDetailsFromRecord(actor: Actor, record: GoalReadRecord): GoalDetails {
  const { goal, latest, measurementCount, updatedAt } = record;
  owned(actor, goal);
  if (latest) {
    requireOwned(actor, { userId: latest.user_id });
    if (latest.goal_id !== goal.id || latest.unit !== goal.unit) throw new NotFoundError();
  }
  if (!Number.isSafeInteger(measurementCount) || measurementCount < 0 || (latest === null) !== (measurementCount === 0)) throw new Error("Invalid measurement summary.");
  return { goal, progress: {
    methodology: { version: 1, mode: "manual", formula: goal.direction === "increase" ? "(current-baseline)/(target-baseline)" : "(baseline-current)/(baseline-target)",
      percentDecimals: 2, rounding: "half_up", clamped: true },
    source: "manual", unit: goal.unit, baseline: goal.baseline, target: goal.target, current: latest?.value ?? null,
    // An example value (LFS-218) is labelled as such; it is never presented as the person's self-report.
    provenance: latest ? { ...(latest.source === "example" ? { kind: "example", source: "example" } as const : { kind: "self_report", source: "manual" } as const),
      measurementId: latest.id, measuredAt: latest.measured_at, recordedAt: latest.created_at, updatedAt: latest.updated_at } : null,
    ...calculateGoalProgress({ baseline: goal.baseline, target: goal.target, direction: goal.direction, current: latest?.value ?? null }),
    updatedAt, measurementCount,
  } };
}
export function createGoalsReader(repository: GoalsReadRepository): GoalsReader {
  return {
    async get(actor, id) { return goalDetailsFromRecord(actor, requireFound(await repository.find(actor, identifier(id)))); },
    async list(actor, input) {
      const parsed = goalsListQuerySchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError();
      const query = parsed.data;
      const after = query.cursor ? decodeGoalsCursor(query.cursor) : null;
      if (after && (after.domain_key !== (query.domain_key ?? null) || after.status !== (query.status ?? null))) throw new InvalidInputError();
      const rows = await repository.list(actor, { limit: query.limit, domain_key: query.domain_key, status: query.status, after: after ?? undefined });
      const page = rows.slice(0, query.limit).map((record) => goalDetailsFromRecord(actor, record));
      const last = page.at(-1)?.goal;
      return { items: page, nextCursor: rows.length > query.limit && last ? encodeGoalsCursor({ created_at: last.created_at, id: last.id,
        domain_key: query.domain_key ?? null, status: query.status ?? null }) : null };
    },
    async history(actor, goalId, input) {
      const id = identifier(goalId);
      const parsed = measurementsListQuerySchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError();
      const query = parsed.data;
      const after = query.cursor ? decodeMeasurementsCursor(query.cursor) : null;
      if (after && after.goal_id !== id) throw new InvalidInputError();
      const result = requireFound(await repository.history(actor, id, { limit: query.limit, after: after ?? undefined }));
      owned(actor, result.goal);
      for (const row of result.items) {
        requireOwned(actor, { userId: row.user_id });
        if (row.goal_id !== id) throw new NotFoundError();
      }
      const page = result.items.slice(0, query.limit);
      const last = page.at(-1);
      return { items: page, measurementCount: result.measurementCount,
        nextCursor: result.items.length > query.limit && last ? encodeMeasurementsCursor({ goal_id: id, measured_at: last.measured_at, created_at: last.created_at, id: last.id }) : null };
    },
  };
}
