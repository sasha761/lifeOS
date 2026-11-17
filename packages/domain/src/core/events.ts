import { goalAuditSnapshotSchema } from "@lifeos/contracts";
import type { ActivityEvent, ActivityEventDraft, Goal } from "@lifeos/contracts";
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
