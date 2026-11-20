import { eq, sql } from "drizzle-orm";
import { activityEventDraftSchema, activityWriterContextSchema } from "@lifeos/contracts";
import type { ActivityWriterContext } from "@lifeos/contracts";
import type { Actor, ActivityEventWriter } from "@lifeos/domain";
import type { LifeosTransaction } from "./client.ts";
import { ownedBy } from "./ownership.ts";
import { activityEvents } from "./schema/activity-events.ts";
import { goals } from "./schema/goals.ts";

/**
 * Requires a real transaction, not a root client. All identity/provenance comes from server context.
 * The command key marks the command's first fact; further facts of the same command (the example, examples giving way
 * to an own value — LFS-218) are stored without it, because `(user_id, idempotency_key)` is unique for events and the
 * command receipt is what replays a retry (ADR-008).
 */
export function createActivityEventWriter(transaction: LifeosTransaction, actor: Actor, options: ActivityWriterContext): ActivityEventWriter {
  const context = activityWriterContextSchema.safeParse(options);
  if (!context.success) throw new Error("Invalid activity event context.");
  let keyed = false;
  return {
    async append(input) {
      const event = activityEventDraftSchema.safeParse(input);
      if (!event.success) throw new Error("Invalid activity event.");
      const [parent] = await transaction.select({ id: goals.id }).from(goals)
        .where(ownedBy(goals.userId, actor, eq(goals.id, event.data.goal_id), eq(goals.domainKey, event.data.domain_key))).limit(1);
      if (!parent) throw new Error("Invalid activity event owner.");
      const idempotencyKey = keyed ? null : context.data.idempotencyKey;
      keyed = true;
      await transaction.insert(activityEvents).values({ userId: actor.userId, domainKey: event.data.domain_key,
        goalId: event.data.goal_id, eventType: event.data.event_type, source: context.data.source,
        targetType: event.data.target_type, targetId: event.data.target_id, idempotencyKey,
        schemaVersion: event.data.schema_version, payload: event.data.payload,
        occurredAt: sql`clock_timestamp()`, createdAt: sql`clock_timestamp()` });
    },
  };
}
