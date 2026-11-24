import { goalAuditSnapshotSchema } from "@lifeos/contracts";
import type { ActivityEvent, ActivityEventDraft, Goal, GoalMeasurement } from "@lifeos/contracts";
import { contributionKind } from "./goal-progress.ts";
import type { Actor } from "./actor.ts";

/** Bound to the command's actor, source, key and Drizzle transaction by the infrastructure adapter. */
export type ActivityEventWriter = { append(event: ActivityEventDraft): Promise<void> };
export type ActivityEventsRepository = {
  find(actor: Actor, id: string): Promise<ActivityEvent | null>;
  /** At most 100 newest events; no unscoped or unlimited audit query. */
  listForGoal(actor: Actor, goalId: string): Promise<ActivityEvent[]>;
};
/** Kind, phase and start date (LFS-225) are part of every new snapshot; the definition is null for a goal without measurements. */
export function goalAuditSnapshot(goal: Goal) {
  return goalAuditSnapshotSchema.parse({
    unit: goal.unit, baseline: goal.baseline, target: goal.target,
    direction: goal.direction, status: goal.status, due_at: goal.due_at,
    ...(goal.measurement_mode ? { measurement_mode: goal.measurement_mode } : {}),
    kind: goal.kind, phase: goal.phase, starts_at: goal.starts_at,
  });
}
export function measurementSnapshot(value: GoalMeasurement, goal?: Extract<Goal, { kind: "numeric" }>) {
  const kind = goal && contributionKind(goal);
  return { value: value.value, measured_at: value.measured_at, source: value.source, ...(kind ? { contribution_kind: kind } : {}) };
}
/** The audit fact of a removed measurement; also used when example measurements give way (LFS-218). */
export function measurementDeletedEvent(goal: Pick<Goal, "id" | "domain_key">, removed: GoalMeasurement): ActivityEventDraft {
  return { goal_id: goal.id, domain_key: goal.domain_key, target_type: "goal_measurement", target_id: removed.id, schema_version: 1,
    event_type: "goal_measurement.deleted", payload: { before: measurementSnapshot(removed), after: null } };
}
