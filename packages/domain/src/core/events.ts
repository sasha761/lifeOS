import { goalAuditSnapshotSchema } from "@lifeos/contracts";
import type { ActivityEvent, ActivityEventDraft, Goal, GoalMeasurement } from "@lifeos/contracts";
import type { Actor } from "./actor.ts";

/** Bound to the command's actor, source, key and Drizzle transaction by the infrastructure adapter. */
export type ActivityEventWriter = { append(event: ActivityEventDraft): Promise<void> };
export type ActivityEventsRepository = {
  find(actor: Actor, id: string): Promise<ActivityEvent | null>;
  /** At most 100 newest events; no unscoped or unlimited audit query. */
  listForGoal(actor: Actor, goalId: string): Promise<ActivityEvent[]>;
};
export function goalAuditSnapshot(goal: Goal) {
  return goalAuditSnapshotSchema.parse({
    unit: goal.unit, baseline: goal.baseline, target: goal.target,
    direction: goal.direction, status: goal.status, due_at: goal.due_at,
  });
}
export function measurementSnapshot(value: GoalMeasurement) {
  return { value: value.value, measured_at: value.measured_at, source: value.source };
}
/** The audit fact of a removed measurement; also used when example measurements give way (LFS-218). */
export function measurementDeletedEvent(goal: Pick<Goal, "id" | "domain_key">, removed: GoalMeasurement): ActivityEventDraft {
  return { goal_id: goal.id, domain_key: goal.domain_key, target_type: "goal_measurement", target_id: removed.id, schema_version: 1,
    event_type: "goal_measurement.deleted", payload: { before: measurementSnapshot(removed), after: null } };
}
