import { eq, sql } from "drizzle-orm";
import { activityEventDraftSchema, goalCommandOptionsSchema } from "@lifeos/contracts";
import type { GoalCommandOptions } from "@lifeos/contracts";
import type { Actor, ActivityEventWriter } from "@lifeos/domain";
import type { LifeosTransaction } from "./client.ts";
import { ownedBy } from "./ownership.ts";
import { activityEvents } from "./schema/activity-events.ts";
import { goals } from "./schema/goals.ts";

/** Requires a real transaction, not a root client. All identity/provenance comes from server context. */
export function createActivityEventWriter(transaction: LifeosTransaction, actor: Actor, options: GoalCommandOptions): ActivityEventWriter {
  const context = goalCommandOptionsSchema.safeParse(options);
  if (!context.success) throw new Error("Invalid activity event context.");
  return {
    async append(input) {
      const event = activityEventDraftSchema.safeParse(input);
      if (!event.success) throw new Error("Invalid activity event.");
      const [parent] = await transaction.select({ id: goals.id }).from(goals)
        .where(ownedBy(goals.userId, actor, eq(goals.id, event.data.goal_id), eq(goals.domainKey, event.data.domain_key))).limit(1);
      if (!parent) throw new Error("Invalid activity event owner.");
      await transaction.insert(activityEvents).values({ userId: actor.userId, domainKey: event.data.domain_key,
        goalId: event.data.goal_id, eventType: event.data.event_type, source: context.data.source,
        targetType: event.data.target_type, targetId: event.data.target_id, idempotencyKey: context.data.idempotencyKey,
        schemaVersion: event.data.schema_version, payload: event.data.payload,
        occurredAt: sql`clock_timestamp()`, createdAt: sql`clock_timestamp()` });
    },
  };
}
