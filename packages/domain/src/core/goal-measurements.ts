import {
  createGoalMeasurementInputSchema, goalCommandOptionsSchema, goalIdSchema, goalValueMatchesUnit,
  MEASUREMENT_FUTURE_TOLERANCE_MS, updateGoalMeasurementInputSchema,
} from "@lifeos/contracts";
import type {
  CreateGoalMeasurementInput, Goal, GoalCommandOptions, GoalMeasurement, GoalMeasurementCurrent,
  GoalMeasurementDeletion, NumericGoal, UpdateGoalMeasurementInput,
} from "@lifeos/contracts";
import type { Actor } from "./actor.ts";
import { goalAuditSnapshot, measurementDeletedEvent, measurementSnapshot } from "./events.ts";
import type { ActivityEventWriter } from "./events.ts";
import { goalDetailsFromRecord } from "./goals-reader.ts";
import type { GoalsReadRepository } from "./goals-reader.ts";
import type { GoalsRepository } from "./goals.ts";
import { ConflictError, InvalidInputError, NotFoundError } from "./errors.ts";
import { requireFound, requireOwned } from "./ownership.ts";

/** What a repository writes: the public input, or an example measurement written only by the example command (LFS-218). */
export type MeasurementDraft = Omit<CreateGoalMeasurementInput, "source"> & { source: GoalMeasurement["source"] };
export type GoalMeasurementsRepository = {
  create(actor: Actor, goal: NumericGoal, input: MeasurementDraft): Promise<GoalMeasurement>;
  find(actor: Actor, id: string): Promise<GoalMeasurement | null>;
  update(actor: Actor, id: string, input: UpdateGoalMeasurementInput): Promise<GoalMeasurement | null>;
  remove(actor: Actor, id: string): Promise<GoalMeasurement | null>;
  list(actor: Actor, goalId: string): Promise<GoalMeasurement[]>;
  /** Deletes the goal's example measurements (LFS-218) and returns them for the audit; called under the goal row lock. */
  removeExamples(actor: Actor, goalId: string): Promise<GoalMeasurement[]>;
};
export type MeasurementMutationResult = GoalMeasurement | GoalMeasurementDeletion;
export type MeasurementCommand = GoalCommandOptions & {
  operation: "measurement.create" | "measurement.update" | "measurement.delete";
  targetId: string;
  input: CreateGoalMeasurementInput | UpdateGoalMeasurementInput | null;
};
export type MeasurementTransaction = { goals: Pick<GoalsRepository, "find" | "claimExample">; measurements: GoalMeasurementsRepository; events: ActivityEventWriter };
export type MeasurementCommandOutcome = { kind: "success"; result: MeasurementMutationResult } | { kind: "conflict" | "not_found" };
export type GoalMeasurementsUnitOfWork = {
  goals: Pick<GoalsRepository, "find">;
  measurements: Pick<GoalMeasurementsRepository, "find" | "list">;
  readCurrent: GoalsReadRepository["find"];
  run(actor: Actor, command: MeasurementCommand, operation: (transaction: MeasurementTransaction) => Promise<MeasurementMutationResult>): Promise<MeasurementCommandOutcome>;
};
export type GoalMeasurementsService = {
  create(actor: Actor, goalId: unknown, input: unknown, options: unknown): Promise<GoalMeasurement>;
  get(actor: Actor, id: unknown): Promise<GoalMeasurement>;
  update(actor: Actor, id: unknown, input: unknown, options: unknown): Promise<GoalMeasurement>;
  remove(actor: Actor, id: unknown, options: unknown): Promise<GoalMeasurementDeletion>;
  current(actor: Actor, goalId: unknown): Promise<GoalMeasurementCurrent>;
  history(actor: Actor, goalId: unknown): Promise<GoalMeasurement[]>;
};
function identifier(value: unknown): string {
  const parsed = goalIdSchema.safeParse(value);
  if (!parsed.success) throw new NotFoundError();
  return parsed.data.toLowerCase();
}
function options(input: unknown): GoalCommandOptions {
  const parsed = goalCommandOptionsSchema.safeParse(input);
  if (!parsed.success) throw new InvalidInputError();
  return parsed.data;
}
function owned<T extends { user_id: string }>(actor: Actor, value: T | null): T {
  const row = requireFound(value);
  requireOwned(actor, { userId: row.user_id });
  return row;
}
const snapshot = measurementSnapshot;

export function createGoalMeasurementsService(unit: GoalMeasurementsUnitOfWork, clock: () => Date = () => new Date()): GoalMeasurementsService {
  function validateValue(goal: NumericGoal, value: string): void {
    if (!goalValueMatchesUnit(value, goal.unit) || (goal.measurement_mode === "contributions" && value === "0")) throw new InvalidInputError();
  }
  function validateTime(value: string): void {
    if (new Date(value).getTime() > clock().getTime() + MEASUREMENT_FUTURE_TOLERANCE_MS) throw new InvalidInputError();
  }
  async function parent(actor: Actor, id: string, goals: Pick<GoalsRepository, "find">): Promise<Goal> {
    return owned(actor, await goals.find(actor, id));
  }
  /** Measurements are written only to an active numeric goal: archive is terminal, a goal without measurements has none (LFS-225). */
  async function writableParent(actor: Actor, id: string, goals: Pick<GoalsRepository, "find">): Promise<NumericGoal> {
    const goal = await parent(actor, id, goals);
    if (goal.status === "archived" || goal.kind !== "numeric") throw new ConflictError();
    return goal;
  }
  async function execute(actor: Actor, command: MeasurementCommand, work: (transaction: MeasurementTransaction) => Promise<MeasurementMutationResult>) {
    const result = await unit.run(actor, command, work);
    if (result.kind === "conflict") throw new ConflictError();
    if (result.kind === "not_found") throw new NotFoundError();
    if (result.kind !== "success") throw new Error("Invalid measurement command outcome.");
    return owned(actor, result.result);
  }
  return {
    async create(actor, goalId, input, context) {
      const parsed = createGoalMeasurementInputSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError();
      const key = identifier(goalId);
      const result = await execute(actor, { ...options(context), operation: "measurement.create", targetId: key, input: parsed.data }, async ({ goals, measurements, events }) => {
        const goal = await writableParent(actor, key, goals);
        validateValue(goal, parsed.data.value); validateTime(parsed.data.measured_at);
        // LFS-218: the first own value replaces the example ones, and an example goal becomes the person's own.
        // Audit order makes the person's measurement the newest fact.
        for (const removed of await measurements.removeExamples(actor, key)) await events.append(measurementDeletedEvent(goal, removed));
        if (goal.origin === "starter") {
          const claimed = owned(actor, await goals.claimExample(actor, key));
          await events.append({ goal_id: key, domain_key: goal.domain_key, target_type: "goal", target_id: key, schema_version: 1,
            event_type: "goal.updated", payload: { before: goalAuditSnapshot(goal), after: goalAuditSnapshot(claimed), changed_fields: ["origin"] } });
        }
        const measurement = owned(actor, await measurements.create(actor, goal, parsed.data));
        await events.append({ goal_id: key, domain_key: goal.domain_key, target_type: "goal_measurement", target_id: measurement.id,
          schema_version: 1, event_type: "goal_measurement.created", payload: { before: null, after: snapshot(measurement, goal) } });
        return measurement;
      });
      if ("deleted" in result) throw new NotFoundError();
      return result;
    },
    async get(actor, id) {
      const measurement = owned(actor, await unit.measurements.find(actor, identifier(id)));
      await parent(actor, measurement.goal_id, unit.goals);
      return measurement;
    },
    async update(actor, id, input, context) {
      const parsed = updateGoalMeasurementInputSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError();
      const key = identifier(id);
      const result = await execute(actor, { ...options(context), operation: "measurement.update", targetId: key, input: parsed.data }, async ({ goals, measurements, events }) => {
        const before = owned(actor, await measurements.find(actor, key));
        const goal = await writableParent(actor, before.goal_id, goals);
        // An example value is not corrected into the person's data: they add their own, which replaces it (LFS-218).
        if (before.source === "example") throw new ConflictError();
        if (parsed.data.value !== undefined) validateValue(goal, parsed.data.value);
        if (parsed.data.measured_at !== undefined) validateTime(parsed.data.measured_at);
        const changed_fields = (["value", "measured_at", "note"] as const).filter((field) => parsed.data[field] !== undefined && parsed.data[field] !== before[field]);
        if (!changed_fields.length) return before;
        const after = owned(actor, await measurements.update(actor, key, parsed.data));
        await events.append({ goal_id: goal.id, domain_key: goal.domain_key, target_type: "goal_measurement", target_id: key,
          schema_version: 1, event_type: "goal_measurement.updated", payload: { before: snapshot(before, goal), after: snapshot(after, goal), changed_fields } });
        return after;
      });
      if ("deleted" in result) throw new NotFoundError();
      return result;
    },
    async remove(actor, id, context) {
      const key = identifier(id);
      const result = await execute(actor, { ...options(context), operation: "measurement.delete", targetId: key, input: null }, async ({ goals, measurements, events }) => {
        const before = owned(actor, await measurements.find(actor, key));
        const goal = await writableParent(actor, before.goal_id, goals);
        owned(actor, await measurements.remove(actor, key));
        await events.append({ goal_id: goal.id, domain_key: goal.domain_key, target_type: "goal_measurement", target_id: key,
          schema_version: 1, event_type: "goal_measurement.deleted", payload: { before: snapshot(before, goal), after: null } });
        return { id: key, goal_id: goal.id, user_id: actor.userId, deleted: true };
      });
      if (!("deleted" in result)) throw new Error("Invalid measurement deletion result.");
      return result;
    },
    async current(actor, goalId) {
      const key = identifier(goalId);
      const record = requireFound(await unit.readCurrent(actor, key));
      if (record.goal.id !== key) throw new NotFoundError();
      const { goal, progress } = goalDetailsFromRecord(actor, record);
      return { goal_id: key, current: progress.current, measurement: record.latest,
        ...(goal.measurement_mode === "contributions" ? { measurement_mode: goal.measurement_mode } : {}) };
    },
    async history(actor, goalId) {
      const key = identifier(goalId);
      await parent(actor, key, unit.goals);
      const measurements = await unit.measurements.list(actor, key);
      for (const measurement of measurements) { owned(actor, measurement); if (measurement.goal_id !== key) throw new NotFoundError(); }
      return measurements;
    },
  };
}
