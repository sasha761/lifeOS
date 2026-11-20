import { desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { activityEventDraftSchema, activityEventMetadataSchema, goalIdSchema } from "@lifeos/contracts";
import type { ActivityEvent } from "@lifeos/contracts";
import type { ActivityEventsRepository } from "@lifeos/domain";
import type { LifeosDatabase } from "../client.ts";
import { ownedBy } from "../ownership.ts";
import { activityEvents } from "../schema/activity-events.ts";

// Inside raw SQL an alias renders as its name only, so the FROM clause below names the table and the alias itself.
const unitChanges = alias(activityEvents, "unit_changes");
/**
 * For a selected activity event: when its goal's unit or custom unit label last changed (LFS-217), as ISO UTC, or null.
 * The owner's (user_id, goal_id, occurred_at, id) index serves the subquery; only goal.updated events are considered.
 */
export const goalUnitChangedAt = sql<string | null>`(
  SELECT to_char(max(${unitChanges.occurredAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM ${activityEvents} AS "unit_changes"
  WHERE ${unitChanges.userId} = ${activityEvents.userId} AND ${unitChanges.goalId} = ${activityEvents.goalId}
    AND ${unitChanges.eventType} = 'goal.updated'
    AND (${unitChanges.payload} -> 'changed_fields' @> '["unit"]'::jsonb OR ${unitChanges.payload} -> 'changed_fields' @> '["unit_label"]'::jsonb))`;
export function toUnitChangedAt(value: string | null): string | null {
  if (value === null) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid stored unit change time.");
  return date.toISOString();
}

export function toActivityEvent(row: typeof activityEvents.$inferSelect): ActivityEvent {
  const draft = activityEventDraftSchema.safeParse({ goal_id: row.goalId, domain_key: row.domainKey,
    target_id: row.targetId, target_type: row.targetType, event_type: row.eventType, schema_version: row.schemaVersion, payload: row.payload });
  const metadata = activityEventMetadataSchema.safeParse({ id: row.id, user_id: row.userId, source: row.source,
    idempotency_key: row.idempotencyKey, occurred_at: row.occurredAt.toISOString(), created_at: row.createdAt.toISOString() });
  if (!draft.success || !metadata.success) throw new Error("Invalid stored activity event.");
  return { ...draft.data, ...metadata.data };
}
export function createActivityEventsRepository(database: Pick<LifeosDatabase, "select">): ActivityEventsRepository {
  return {
    async find(actor, id) {
      if (!goalIdSchema.safeParse(id).success) return null;
      const [row] = await database.select().from(activityEvents).where(ownedBy(activityEvents.userId, actor, eq(activityEvents.id, id))).limit(1);
      return row ? toActivityEvent(row) : null;
    },
    async listForGoal(actor, goalId) {
      if (!goalIdSchema.safeParse(goalId).success) return [];
      const rows = await database.select().from(activityEvents).where(ownedBy(activityEvents.userId, actor, eq(activityEvents.goalId, goalId)))
        .orderBy(desc(activityEvents.occurredAt), desc(activityEvents.id)).limit(100);
      return rows.map(toActivityEvent);
    },
  };
}
