import { and, asc, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import type { DashboardReadRepository } from "@lifeos/domain";
import type { LifeosDatabase } from "../client.ts";
import { ownedBy } from "../ownership.ts";
import { activityEvents } from "../schema/activity-events.ts";
import { user } from "../schema/auth.ts";
import { goalMeasurements } from "../schema/goal-measurements.ts";
import { goals } from "../schema/goals.ts";
import { onboardingState } from "../schema/onboarding.ts";
import { goalUnitChangedAt, toActivityEvent, toUnitChangedAt } from "./activity-events.ts";
import { toGoal } from "./goals.ts";
import { summarizeGoals } from "./goals-reader.ts";

const readSnapshot = { isolationLevel: "repeatable read", accessMode: "read only" } as const;
function count(value: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("Invalid stored goal count.");
  return result;
}

/**
 * Dashboard read model (LFS-204): plain owner-scoped SQL under one READ ONLY REPEATABLE READ snapshot,
 * like the goals reader (ADR-010). The number of queries is fixed — counts, example measurements (LFS-218), focus spheres (LFS-219), ranked goals, deadlines,
 * the shared three-query goal summary and activity — and never grows with the number of goals.
 * No snapshots, materialized views or background projections.
 */
export function createDashboardReadRepository(database: LifeosDatabase): DashboardReadRepository {
  return {
    read(actor, limits) {
      return database.transaction(async (transaction) => {
        // The origin in the same grouping counts the example goals for the banner (LFS-218) without another goal query.
        const counts = await transaction.select({ domainKey: goals.domainKey, status: goals.status, origin: goals.origin, total: sql<string>`count(*)::text` })
          .from(goals).where(ownedBy(goals.userId, actor)).groupBy(goals.domainKey, goals.status, goals.origin);
        const [examples] = await transaction.select({ total: sql<string>`count(*)::text` }).from(goalMeasurements)
          .where(ownedBy(goalMeasurements.userId, actor, eq(goalMeasurements.source, "example")));
        // «Сферы в фокусе» (LFS-219) and the setup status for the first-visit popup (LFS-220) from the actor's own rows.
        const [profile] = await transaction.select({ focusDomains: user.focusDomains, onboardingStatus: onboardingState.status }).from(user)
          .leftJoin(onboardingState, eq(onboardingState.userId, user.id)).where(ownedBy(user.id, actor)).limit(1);
        // Newest active goals per sphere; the window keeps it one query for all six spheres.
        const ranked = transaction.select({ id: goals.id,
          rank: sql<number>`row_number() over (partition by ${goals.domainKey} order by ${goals.createdAt} desc, ${goals.id} desc)`.as("rank") })
          .from(goals).where(ownedBy(goals.userId, actor, eq(goals.status, "active"))).as("ranked");
        const domainRows = await transaction.select({ goal: goals }).from(goals).innerJoin(ranked, eq(ranked.id, goals.id))
          .where(ownedBy(goals.userId, actor, lte(ranked.rank, limits.goalsPerDomain)))
          .orderBy(goals.domainKey, desc(goals.createdAt), desc(goals.id));
        const dueRows = await transaction.select().from(goals)
          .where(ownedBy(goals.userId, actor, eq(goals.status, "active"), isNotNull(goals.dueAt)))
          .orderBy(asc(goals.dueAt), asc(goals.id)).limit(limits.dueGoals);
        const domainGoals = domainRows.map((row) => toGoal(row.goal));
        const dueGoals = dueRows.map(toGoal);
        const unique = [...new Map([...domainGoals, ...dueGoals].map((goal) => [goal.id, goal])).values()];
        const summaries = new Map((await summarizeGoals(transaction, actor, unique)).map((record) => [record.goal.id, record]));
        // The compound key matches the audit FK (owner, sphere, goal); both sides stay owner-filtered.
        const events = await transaction.select({ event: activityEvents, goal: goals, unitChangedAt: goalUnitChangedAt }).from(activityEvents)
          .innerJoin(goals, and(eq(goals.userId, activityEvents.userId), eq(goals.domainKey, activityEvents.domainKey), eq(goals.id, activityEvents.goalId)))
          .where(ownedBy(activityEvents.userId, actor, ownedBy(goals.userId, actor)))
          .orderBy(desc(activityEvents.occurredAt), desc(activityEvents.id)).limit(limits.activity);
        return {
          counts: counts.map((row) => ({ domainKey: row.domainKey, status: row.status, origin: row.origin, total: count(row.total) })),
          exampleMeasurements: count(examples?.total ?? "0"),
          focusDomains: profile?.focusDomains ?? null,
          onboardingStatus: profile?.onboardingStatus ?? null,
          domainGoals: domainGoals.map((goal) => summaries.get(goal.id)!),
          dueGoals: dueGoals.map((goal) => summaries.get(goal.id)!),
          activity: events.map((row) => ({ event: toActivityEvent(row.event), goal: toGoal(row.goal), unitChangedAt: toUnitChangedAt(row.unitChangedAt) })),
        };
      }, readSnapshot);
    },
  };
}
