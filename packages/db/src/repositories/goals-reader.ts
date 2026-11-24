import { desc, eq, inArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Goal } from "@lifeos/contracts";
import type { Actor, GoalReadRecord, GoalsReadRepository } from "@lifeos/domain";
import type { LifeosDatabase, LifeosTransaction } from "../client.ts";
import { ownedBy } from "../ownership.ts";
import { goals } from "../schema/goals.ts";
import { goalMeasurements } from "../schema/goal-measurements.ts";
import { activityEvents } from "../schema/activity-events.ts";
import { ownMeasurementCreated } from "./activity-events.ts";
import { toGoal } from "./goals.ts";
import { toGoalMeasurement } from "./goal-measurements.ts";

const readSnapshot = { isolationLevel: "repeatable read", accessMode: "read only" } as const;
function count(value: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("Invalid stored measurement count.");
  return result;
}
/** Bounded batched queries under one snapshot; never an unscoped lookup or an N+1 per goal. */
export async function summarizeGoals(transaction: LifeosTransaction, actor: Actor, rows: Goal[]): Promise<GoalReadRecord[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const counts = await transaction.select({ goalId: goalMeasurements.goalId, total: sql<string>`count(*)::text`,
    contributionTotal: sql<string>`trim_scale(sum(${goalMeasurements.value}))::text` })
    .from(goalMeasurements).where(ownedBy(goalMeasurements.userId, actor, inArray(goalMeasurements.goalId, ids))).groupBy(goalMeasurements.goalId);
  const latest = await transaction.selectDistinctOn([goalMeasurements.goalId]).from(goalMeasurements)
    .where(ownedBy(goalMeasurements.userId, actor, inArray(goalMeasurements.goalId, ids)))
    .orderBy(goalMeasurements.goalId, desc(goalMeasurements.measuredAt), desc(goalMeasurements.createdAt), desc(goalMeasurements.id));
  const changes = await transaction.select({ goalId: activityEvents.goalId, updatedAt: sql<string>`max(${activityEvents.occurredAt})::text`,
    measurementModeLocked: sql<boolean>`bool_or(${ownMeasurementCreated})` })
    .from(activityEvents).where(ownedBy(activityEvents.userId, actor, inArray(activityEvents.goalId, ids))).groupBy(activityEvents.goalId);
  const totalsByGoal = new Map(counts.map((row) => [row.goalId, row]));
  const latestByGoal = new Map(latest.map((row) => [row.goalId, toGoalMeasurement(row)]));
  const changeByGoal = new Map(changes.map((row) => [row.goalId, row]));
  return rows.map((goal) => {
    const totals = totalsByGoal.get(goal.id);
    const change = changeByGoal.get(goal.id);
    const lastEventAt = change ? new Date(change.updatedAt).toISOString() : goal.updated_at;
    return { goal, latest: latestByGoal.get(goal.id) ?? null, measurementCount: count(totals?.total ?? "0"),
      contributionTotal: totals?.contributionTotal, measurementModeLocked: change?.measurementModeLocked,
      updatedAt: lastEventAt > goal.updated_at ? lastEventAt : goal.updated_at };
  });
}
export function createGoalsReadRepository(database: LifeosDatabase): GoalsReadRepository {
  return {
    find(actor, id) {
      return database.transaction(async (transaction) => {
        const [row] = await transaction.select().from(goals).where(ownedBy(goals.userId, actor, eq(goals.id, id))).limit(1);
        return row ? (await summarizeGoals(transaction, actor, [toGoal(row)]))[0]! : null;
      }, readSnapshot);
    },
    list(actor, query) {
      return database.transaction(async (transaction) => {
        const filters: SQL[] = [];
        if (query.domain_key !== undefined) filters.push(eq(goals.domainKey, query.domain_key));
        if (query.status !== undefined) filters.push(eq(goals.status, query.status));
        if (query.after) filters.push(sql`(${goals.createdAt}, ${goals.id}) < (${new Date(query.after.created_at)}, ${query.after.id}::uuid)`);
        const rows = await transaction.select().from(goals).where(ownedBy(goals.userId, actor, ...filters))
          .orderBy(desc(goals.createdAt), desc(goals.id)).limit(query.limit + 1);
        return summarizeGoals(transaction, actor, rows.map(toGoal));
      }, readSnapshot);
    },
    history(actor, goalId, query) {
      return database.transaction(async (transaction) => {
        const [parent] = await transaction.select().from(goals).where(ownedBy(goals.userId, actor, eq(goals.id, goalId))).limit(1);
        if (!parent) return null;
        const filters: SQL[] = [eq(goalMeasurements.goalId, goalId)];
        if (query.after) filters.push(sql`(${goalMeasurements.measuredAt}, ${goalMeasurements.createdAt}, ${goalMeasurements.id}) < (${new Date(query.after.measured_at)}, ${new Date(query.after.created_at)}, ${query.after.id}::uuid)`);
        const rows = await transaction.select().from(goalMeasurements).where(ownedBy(goalMeasurements.userId, actor, ...filters))
          .orderBy(desc(goalMeasurements.measuredAt), desc(goalMeasurements.createdAt), desc(goalMeasurements.id)).limit(query.limit + 1);
        const [total] = await transaction.select({ total: sql<string>`count(*)::text` }).from(goalMeasurements)
          .where(ownedBy(goalMeasurements.userId, actor, eq(goalMeasurements.goalId, goalId)));
        return { goal: toGoal(parent), items: rows.map(toGoalMeasurement), measurementCount: count(total?.total ?? "0") };
      }, readSnapshot);
    },
  };
}
