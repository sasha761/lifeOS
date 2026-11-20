import { createGoalInputSchema, GOAL_DEFINITION_FIELDS, GOAL_METADATA_FIELDS, goalCommandOptionsSchema, goalIdSchema, updateGoalInputSchema } from "@lifeos/contracts";
import type { CreateGoalInput, Goal, GoalCommandOptions, GoalDeletion, UpdateGoalInput } from "@lifeos/contracts";
import type { Actor } from "./actor.ts";
import { ConflictError, InvalidInputError, NotFoundError } from "./errors.ts";
import { requireFound, requireOwned } from "./ownership.ts";
import { goalAuditSnapshot, measurementDeletedEvent } from "./events.ts";
import type { ActivityEventWriter } from "./events.ts";
import type { GoalMeasurementsRepository } from "./goal-measurements.ts";

/** Each operation is scoped to the verified actor in SQL; no unscoped resource lookup is allowed. */
export type GoalsRepository = {
  /** `origin` is assigned by the server only: `manual` unless the example command creates a `starter` goal (LFS-218). */
  create(actor: Actor, input: CreateGoalInput, options?: { origin?: Goal["origin"] }): Promise<Goal>;
  find(actor: Actor, id: string): Promise<Goal | null>;
  /**
   * Atomic update conditional on status=active and, when the input carries a definition, on the goal having no own
   * measurements (LFS-217; example measurements are removed first, LFS-218). An example goal becomes `manual` in the
   * same statement. Null means missing, foreign, concurrently archived or measured.
   */
  updateActive(actor: Actor, id: string, input: UpdateGoalInput): Promise<Goal | null>;
  /** Whether the owned goal has a measurement of the person's own (not an example); called under the goal row lock. */
  hasOwnMeasurements(actor: Actor, id: string): Promise<boolean>;
  /** An example goal becomes the person's own (`starter` → `manual`, LFS-218); null if it was not an example. */
  claimExample(actor: Actor, id: string): Promise<Goal | null>;
  /** Atomic transition to archived, or the unchanged row if already archived; never hard deletes. */
  archive(actor: Actor, id: string): Promise<Goal | null>;
  /** Owner-scoped hard delete; dependent rows cascade in the same transaction. */
  deleteGoal(actor: Actor, id: string): Promise<Goal | null>;
};

export type GoalsService = {
  create(actor: Actor, input: unknown, options: unknown): Promise<Goal>;
  get(actor: Actor, id: unknown): Promise<Goal>;
  update(actor: Actor, id: unknown, input: unknown, options: unknown): Promise<Goal>;
  archive(actor: Actor, id: unknown, options: unknown): Promise<Goal>;
  deleteGoal(actor: Actor, id: unknown, options: unknown): Promise<GoalDeletion>;
};

export type GoalCommand = GoalCommandOptions & {
  operation: "create" | "update" | "archive";
  targetId: string | null;
  input: CreateGoalInput | UpdateGoalInput | null;
};
export type GoalCommandOutcome = { kind: "success"; goal: Goal } | { kind: "conflict" | "not_found" };
export type GoalTransaction = { goals: GoalsRepository; measurements: Pick<GoalMeasurementsRepository, "removeExamples">; events: ActivityEventWriter };
export type GoalDeletionCommand = GoalCommandOptions & { operation: "delete"; targetId: string; input: null };
export type GoalDeletionOutcome = { kind: "success"; result: GoalDeletion } | { kind: "conflict" | "not_found" };
export type GoalsUnitOfWork = {
  goals: Pick<GoalsRepository, "find">;
  run(actor: Actor, command: GoalCommand, operation: (transaction: GoalTransaction) => Promise<Goal>): Promise<GoalCommandOutcome>;
  runDeletion(actor: Actor, command: GoalDeletionCommand, operation: (goals: GoalsRepository) => Promise<GoalDeletion>): Promise<GoalDeletionOutcome>;
};
function commandOptions(input: unknown): GoalCommandOptions {
  const parsed = goalCommandOptionsSchema.safeParse(input);
  if (!parsed.success) throw new InvalidInputError();
  return parsed.data;
}

function resourceId(value: unknown): string {
  const parsed = goalIdSchema.safeParse(value);
  if (!parsed.success) throw new NotFoundError();
  return parsed.data.toLowerCase();
}

function ownedGoal(actor: Actor, value: Goal | null): Goal {
  const goal = requireFound(value);
  requireOwned(actor, { userId: goal.user_id });
  return goal;
}

export function createGoalsService(unit: GoalsUnitOfWork): GoalsService {
  async function execute(actor: Actor, command: GoalCommand, operation: (transaction: GoalTransaction) => Promise<Goal>): Promise<Goal> {
    const result = await unit.run(actor, command, operation);
    if (result.kind === "conflict") throw new ConflictError();
    if (result.kind === "not_found") throw new NotFoundError();
    if (result.kind !== "success") throw new Error("Invalid goal command outcome.");
    return ownedGoal(actor, result.goal);
  }
  return {
    async deleteGoal(actor, id, options) {
      const key = resourceId(id);
      const outcome = await unit.runDeletion(actor, { ...commandOptions(options), operation: "delete", targetId: key, input: null }, async (goals) => {
        // Same parent lock order as measurement writes. Archived goals may also be deleted.
        ownedGoal(actor, await goals.find(actor, key));
        const deleted = ownedGoal(actor, await goals.deleteGoal(actor, key));
        return { id: deleted.id, user_id: actor.userId, deleted: true };
      });
      if (outcome.kind === "conflict") throw new ConflictError();
      if (outcome.kind === "not_found") throw new NotFoundError();
      if (outcome.kind !== "success") throw new Error("Invalid goal deletion outcome.");
      requireOwned(actor, { userId: outcome.result.user_id });
      return outcome.result;
    },
    async create(actor, input, options) {
      const parsed = createGoalInputSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError();
      return execute(actor, { ...commandOptions(options), operation: "create", targetId: null, input: parsed.data }, async ({ goals, events }) => {
        const goal = ownedGoal(actor, await goals.create(actor, parsed.data));
        await events.append({ goal_id: goal.id, domain_key: goal.domain_key, target_type: "goal", target_id: goal.id, schema_version: 1,
          event_type: "goal.created", payload: { before: null, after: goalAuditSnapshot(goal) } });
        return goal;
      });
    },
    async get(actor, id) {
      return ownedGoal(actor, await unit.goals.find(actor, resourceId(id)));
    },
    async update(actor, id, input, options) {
      const parsed = updateGoalInputSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError();
      const key = resourceId(id);
      return execute(actor, { ...commandOptions(options), operation: "update", targetId: key, input: parsed.data }, async ({ goals, measurements, events }) => {
        // The row lock taken by find() is the same parent lock measurement writes take first, so «no measurements»
        // cannot change between the check and the update.
        const current = ownedGoal(actor, await goals.find(actor, key));
        if (current.status === "archived") throw new ConflictError();
        const edited = [...GOAL_METADATA_FIELDS, ...GOAL_DEFINITION_FIELDS]
          .filter((field) => parsed.data[field] !== undefined && parsed.data[field] !== current[field]);
        if (edited.length === 0) return current;
        // Any real edit makes an example the person's own goal (LFS-218); updateActive writes the origin.
        const changed_fields = current.origin === "starter" ? [...edited, "origin" as const] : edited;
        const redefines = edited.some((field) => (GOAL_DEFINITION_FIELDS as readonly string[]).includes(field));
        // An unchanged definition is not a redefinition: it is dropped, so metadata edits of a measured goal still work.
        const input = redefines ? parsed.data
          : Object.fromEntries(GOAL_METADATA_FIELDS.filter((field) => parsed.data[field] !== undefined).map((field) => [field, parsed.data[field]])) as UpdateGoalInput;
        if (redefines) {
          // Only the person's own measurements fix the definition. Example measurements would be reinterpreted by it,
          // so they are removed with an audit fact before the goal changes (the unit FK requires that order).
          if (await goals.hasOwnMeasurements(actor, key)) throw new ConflictError();
          for (const removed of await measurements.removeExamples(actor, key)) await events.append(measurementDeletedEvent(current, removed));
        }
        const updated = await goals.updateActive(actor, key, input);
        if (!updated) throw new ConflictError();
        ownedGoal(actor, updated);
        await events.append({ goal_id: key, domain_key: updated.domain_key, target_type: "goal", target_id: key, schema_version: 1,
          event_type: "goal.updated", payload: { before: goalAuditSnapshot(current), after: goalAuditSnapshot(updated), changed_fields } });
        return updated;
      });
    },
    async archive(actor, id, options) {
      const key = resourceId(id);
      return execute(actor, { ...commandOptions(options), operation: "archive", targetId: key, input: null }, async ({ goals, events }) => {
        const current = ownedGoal(actor, await goals.find(actor, key));
        if (current.status === "archived") return current;
        const archived = ownedGoal(actor, await goals.archive(actor, key));
        await events.append({ goal_id: key, domain_key: archived.domain_key, target_type: "goal", target_id: key, schema_version: 1,
          event_type: "goal.archived", payload: { before: goalAuditSnapshot(current), after: goalAuditSnapshot(archived) } });
        return archived;
      });
    },
  };
}
