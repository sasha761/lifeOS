import { and, desc, eq } from "drizzle-orm";
import type { ActivityReadRepository } from "@lifeos/domain";
import type { LifeosDatabase } from "../client.ts";
import { ownedBy } from "../ownership.ts";
import { activityEvents } from "../schema/activity-events.ts";
import { goals } from "../schema/goals.ts";
import { goalUnitChangedAt, toActivityEvent, toUnitChangedAt } from "./activity-events.ts";
import { toGoal } from "./goals.ts";

/**
 * Activity journal (LFS-213): one owner-scoped query, newest first, served by the existing
 * (user_id, domain_key|goal_id, occurred_at, id) indexes. A foreign goal or sphere matches no rows,
 * so it is indistinguishable from an unknown one.
 */
export function createActivityReadRepository(database: LifeosDatabase): ActivityReadRepository {
  return {
    async list(actor, { domainKey, goalId, limit }) {
      const filters = [
        ...(domainKey === null ? [] : [eq(activityEvents.domainKey, domainKey)]),
        ...(goalId === null ? [] : [eq(activityEvents.goalId, goalId)]),
      ];
      // The compound key matches the audit FK (owner, sphere, goal); both sides stay owner-filtered.
      const rows = await database.select({ event: activityEvents, goal: goals, unitChangedAt: goalUnitChangedAt }).from(activityEvents)
        .innerJoin(goals, and(eq(goals.userId, activityEvents.userId), eq(goals.domainKey, activityEvents.domainKey), eq(goals.id, activityEvents.goalId)))
        .where(ownedBy(activityEvents.userId, actor, ownedBy(goals.userId, actor), ...filters))
        .orderBy(desc(activityEvents.occurredAt), desc(activityEvents.id)).limit(limit);
      return rows.map((row) => ({ event: toActivityEvent(row.event), goal: toGoal(row.goal), unitChangedAt: toUnitChangedAt(row.unitChangedAt) }));
    },
  };
}
