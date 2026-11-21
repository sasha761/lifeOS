import { activityQuerySchema } from "@lifeos/contracts";
import type { ActivityEntry, ActivityEvent, ActivityFeed, DashboardActivity, DomainKey, Goal } from "@lifeos/contracts";
import type { Actor } from "./actor.ts";
import { InvalidInputError } from "./errors.ts";

/** An owned audit event with the current row of its goal; titles are never copied into the audit log (ADR-008). */
export type ActivityRecord = {
  event: ActivityEvent;
  goal: Pick<Goal, "id" | "user_id" | "domain_key" | "title" | "status" | "unit" | "unit_label">;
  /**
   * When the goal's unit or custom unit label last changed (LFS-217), from its own goal.updated events; absent or null
   * if never. Measurements recorded up to that moment were entered in another unit, which the log does not keep.
   */
  unitChangedAt?: string | null;
};
export type ActivityFilter = { domainKey: DomainKey | null; goalId: string | null; limit: number };
/** Owner-scoped, newest first, at most `limit` rows; one query regardless of the journal size. */
export type ActivityReadRepository = { list(actor: Actor, filter: ActivityFilter): Promise<ActivityRecord[]> };
export type ActivityReader = { list(actor: Actor, input: unknown): Promise<ActivityFeed> };

/** Facts that do not belong to the actor (or to a mismatched goal) are hidden rather than shown. */
export function isVisibleActivity(actor: Actor, { event, goal }: ActivityRecord): boolean {
  return event.user_id === actor.userId && goal.user_id === actor.userId && event.goal_id === goal.id && event.domain_key === goal.domain_key;
}

export function newestActivityFirst(a: { occurredAt: string; id: string }, b: { occurredAt: string; id: string }): number {
  return b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id);
}

/** Everything a person needs to read one fact, taken only from the stored payload and the current goal row. */
export function toActivityEntry({ event, goal, unitChangedAt = null }: ActivityRecord): ActivityEntry {
  let measurement: ActivityEntry["measurement"] = null;
  // ISO UTC strings with millisecond precision compare chronologically.
  const unit = unitChangedAt !== null && event.occurred_at <= unitChangedAt
    ? { unit: null, unitLabel: null } : { unit: goal.unit, unitLabel: goal.unit_label };
  if (event.event_type === "goal_measurement.created") measurement = { value: event.payload.after.value, previousValue: null, ...unit };
  else if (event.event_type === "goal_measurement.updated") measurement = { value: event.payload.after.value, previousValue: event.payload.before.value, ...unit };
  else if (event.event_type === "goal_measurement.deleted") measurement = { value: event.payload.before.value, previousValue: null, ...unit };
  const changedFields = event.event_type === "goal.updated" ? [...event.payload.changed_fields] : null;
  const dueAt = event.event_type === "goal.updated" && event.payload.changed_fields.includes("due_at")
    ? { before: event.payload.before.due_at, after: event.payload.after.due_at } : null;
  const definitionOf = ({ unit, baseline, target, direction }: { unit: Goal["unit"]; baseline: string; target: string; direction: Goal["direction"] }) => ({ unit, baseline, target, direction });
  const definition = event.event_type === "goal.updated" && event.payload.changed_fields.some((field) => ["unit", "baseline", "target", "direction"].includes(field))
    ? { before: definitionOf(event.payload.before), after: definitionOf(event.payload.after) } : null;
  // LFS-218: written by loading the example, or about an example value (also when the person removes it).
  const snapshot = event.target_type === "goal_measurement" ? (event.payload.after ?? event.payload.before) : null;
  const example = event.source === "starter" || snapshot?.source === "example";
  return {
    id: event.id, type: event.event_type, occurredAt: event.occurred_at, source: event.source, domainKey: event.domain_key,
    goal: { id: goal.id, title: goal.title, status: goal.status }, measurement, changedFields, dueAt, definition, example,
  };
}

/** The Dashboard keeps its LFS-204 shape: the same fact without edit details. */
export function toDashboardActivity(record: ActivityRecord): DashboardActivity {
  const { id, type, occurredAt, source, domainKey, goal, measurement, example } = toActivityEntry(record);
  return { id, type, occurredAt, source, domainKey, goal,
    measurement: measurement && { value: measurement.value, unit: measurement.unit, unitLabel: measurement.unitLabel }, example };
}

/** GET /api/v1/activity: the actor's own journal, optionally for one sphere or one goal; foreign ids simply match nothing. */
export function createActivityReader(repository: ActivityReadRepository): ActivityReader {
  return {
    async list(actor, input) {
      const parsed = activityQuerySchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError();
      const { limit, domain_key: domainKey = null, goal_id: goalId = null } = parsed.data;
      const records = await repository.list(actor, { domainKey, goalId, limit });
      const items = records.filter((record) => isVisibleActivity(actor, record))
        .filter(({ event }) => (domainKey === null || event.domain_key === domainKey) && (goalId === null || event.goal_id === goalId))
        .map(toActivityEntry).sort(newestActivityFirst).slice(0, limit);
      return { items };
    },
  };
}
