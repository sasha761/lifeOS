import { desc, eq } from "drizzle-orm";
import { activityEventDraftSchema, activityEventMetadataSchema, goalIdSchema } from "@lifeos/contracts";
import type { ActivityEvent } from "@lifeos/contracts";
import type { ActivityEventsRepository } from "@lifeos/domain";
import type { LifeosDatabase } from "../client.ts";
import { ownedBy } from "../ownership.ts";
import { activityEvents } from "../schema/activity-events.ts";

function fromRow(row: typeof activityEvents.$inferSelect): ActivityEvent {
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
      return row ? fromRow(row) : null;
    },
    async listForGoal(actor, goalId) {
      if (!goalIdSchema.safeParse(goalId).success) return [];
      const rows = await database.select().from(activityEvents).where(ownedBy(activityEvents.userId, actor, eq(activityEvents.goalId, goalId)))
        .orderBy(desc(activityEvents.occurredAt), desc(activityEvents.id)).limit(100);
      return rows.map(fromRow);
    },
  };
}
