import { eq, ne, notExists, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { goalSchema } from "@lifeos/contracts";
import type { Goal } from "@lifeos/contracts";
import type { GoalsRepository } from "@lifeos/domain";
import type { LifeosDatabase } from "../client.ts";
import { ownedBy } from "../ownership.ts";
import { ownMeasurementCreated } from "./activity-events.ts";
import { activityEvents } from "../schema/activity-events.ts";
import { goalMeasurements } from "../schema/goal-measurements.ts";
import { goals } from "../schema/goals.ts";

// Unconstrained numeric preserves display scale from SQL inserts. Insignificant zeros may exceed
// the input contract's lexical scale while the stored value still satisfies all precision CHECKs.
function storedDecimal(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

export function toGoal(row: typeof goals.$inferSelect): Goal {
  const parsed = goalSchema.safeParse({
    id: row.id, user_id: row.userId, domain_key: row.domainKey, title: row.title, description: row.description,
    kind: row.kind, measurement_mode: row.kind === "numeric" ? row.measurementMode : null, unit: row.unit, unit_label: row.unitLabel, baseline: row.baseline === null ? null : storedDecimal(row.baseline),
    target: row.target === null ? null : storedDecimal(row.target), direction: row.direction,
    calculation_mode: row.calculationMode, metric_key: row.metricKey, status: row.status, origin: row.origin,
    phase: row.phase, phase_changed_at: row.phaseChangedAt.toISOString(), starts_at: row.startsAt?.toISOString() ?? null,
    due_at: row.dueAt?.toISOString() ?? null, created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString(),
  });
  if (!parsed.success) throw new Error("Invalid stored goal.");
  return parsed.data;
}

/** Accepts a database or a transaction-bound adapter; audit composition belongs to LFS-210. */
export function createGoalsRepository(database: Pick<LifeosDatabase, "select" | "insert" | "update" | "delete">, options: { lockRows?: boolean } = {}): GoalsRepository {
  const repository: GoalsRepository = {
    async deleteGoal(actor, id) {
      const [row] = await database.delete(goals).where(ownedBy(goals.userId, actor, eq(goals.id, id))).returning();
      return row ? toGoal(row) : null;
    },
    async create(actor, input, options = {}) {
      const definition = input.kind === "numeric"
        ? { unit: input.unit, unitLabel: input.unit_label, baseline: input.baseline, target: input.target, direction: input.direction }
        : { unit: null, unitLabel: null, baseline: null, target: null, direction: null };
      const startsAt = input.starts_at === null ? null : new Date(input.starts_at);
      // LFS-225: a start after the moment of creation (database time, as created_at) makes the goal planned.
      const phase: SQL<"planned" | "in_progress"> | "in_progress" = startsAt === null ? "in_progress"
        : sql<"planned" | "in_progress">`CASE WHEN ${startsAt.toISOString()}::timestamptz > clock_timestamp() THEN 'planned' ELSE 'in_progress' END`;
      const [row] = await database.insert(goals).values({
        userId: actor.userId, domainKey: input.domain_key, title: input.title, description: input.description,
        kind: input.kind, ...definition, measurementMode: input.kind === "numeric" ? input.measurement_mode : undefined, calculationMode: input.calculation_mode, metricKey: input.metric_key,
        status: "active", origin: options.origin ?? "manual", phase, startsAt, dueAt: input.due_at === null ? null : new Date(input.due_at),
        // Statement time, not transaction start: goals created by one command (the example, LFS-218) keep their order.
        createdAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()`, phaseChangedAt: sql`clock_timestamp()`,
      }).returning();
      if (!row) throw new Error("Goal insert returned no row.");
      return toGoal(row);
    },
    async find(actor, id) {
      const query = database.select().from(goals).where(ownedBy(goals.userId, actor, eq(goals.id, id))).limit(1);
      const [row] = await (options.lockRows ? query.for("update") : query);
      return row ? toGoal(row) : null;
    },
    async hasOwnMeasurements(actor, id) {
      const [row] = await database.select({ id: goalMeasurements.id }).from(goalMeasurements)
        .where(ownedBy(goalMeasurements.userId, actor, eq(goalMeasurements.goalId, id), ne(goalMeasurements.source, "example"))).limit(1);
      return row !== undefined;
    },
    async hasMeasurementHistory(actor, id) {
      const [row] = await database.select({ id: activityEvents.id }).from(activityEvents)
        .where(ownedBy(activityEvents.userId, actor, eq(activityEvents.goalId, id), ownMeasurementCreated)).limit(1);
      return row !== undefined;
    },
    async claimExample(actor, id) {
      const [row] = await database.update(goals).set({ origin: "manual", updatedAt: sql`clock_timestamp()` })
        .where(ownedBy(goals.userId, actor, eq(goals.id, id), eq(goals.origin, "starter"))).returning();
      return row ? toGoal(row) : null;
    },
    async updateActive(actor, id, input) {
      // Whitelisted SET (ADR-007). A definition is written only as a whole group and only while no own measurement exists
      // (LFS-217/218): the guard repeats the service check in SQL, and the (user, goal, unit) FK also rejects a unit change
      // while any measurement, including an example one, is left. Any edit makes an example the person's own (LFS-218).
      const redefines = input.unit !== undefined;
      const changesDefinition = redefines || input.measurement_mode !== undefined;
      const instant = (value: string | null | undefined) => value === undefined ? undefined : value === null ? null : new Date(value);
      const [row] = await database.update(goals).set({
        title: input.title, description: input.description,
        startsAt: instant(input.starts_at), dueAt: instant(input.due_at), measurementMode: input.measurement_mode,
        ...(redefines ? { unit: input.unit, unitLabel: input.unit_label ?? null, baseline: input.baseline, target: input.target, direction: input.direction } : {}),
        origin: sql`CASE WHEN ${goals.origin} = 'starter' THEN 'manual' ELSE ${goals.origin} END`,
        updatedAt: sql`clock_timestamp()`,
      }).where(ownedBy(goals.userId, actor, eq(goals.id, id), eq(goals.status, "active"),
        // A goal without measurements never takes a definition (LFS-225); the kind CHECK would reject it as well.
        ...(changesDefinition ? [eq(goals.kind, "numeric"), notExists(database.select({ id: goalMeasurements.id }).from(goalMeasurements)
          .where(ownedBy(goalMeasurements.userId, actor, eq(goalMeasurements.goalId, id), ne(goalMeasurements.source, "example"))))] : []))).returning();
      return row ? toGoal(row) : null;
    },
    async setPhase(actor, id, phase) {
      const [row] = await database.update(goals).set({ phase, phaseChangedAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()` })
        .where(ownedBy(goals.userId, actor, eq(goals.id, id), eq(goals.status, "active"))).returning();
      return row ? toGoal(row) : null;
    },
    async archive(actor, id) {
      const [row] = await database.update(goals).set({ status: "archived", updatedAt: sql`clock_timestamp()` })
        .where(ownedBy(goals.userId, actor, eq(goals.id, id), eq(goals.status, "active"))).returning();
      // Repeat archive preserves the row and its timestamp; foreign/missing ids still return null.
      return row ? toGoal(row) : repository.find(actor, id);
    },
  };
  return repository;
}
