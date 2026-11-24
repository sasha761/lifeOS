import { desc, eq, ne, sql } from "drizzle-orm";
import { goalMeasurementSchema } from "@lifeos/contracts";
import type { GoalMeasurement } from "@lifeos/contracts";
import type { GoalMeasurementsRepository } from "@lifeos/domain";
import type { LifeosDatabase } from "../client.ts";
import { ownedBy } from "../ownership.ts";
import { goalMeasurements } from "../schema/goal-measurements.ts";
export function toGoalMeasurement(row: typeof goalMeasurements.$inferSelect): GoalMeasurement {
  const value = row.value.includes(".") ? row.value.replace(/0+$/, "").replace(/\.$/, "") : row.value;
  const parsed = goalMeasurementSchema.safeParse({ id: row.id, goal_id: row.goalId, user_id: row.userId, unit: row.unit,
    value, measured_at: row.measuredAt.toISOString(), source: row.source, note: row.note,
    created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString() });
  if (!parsed.success) throw new Error("Invalid stored goal measurement.");
  return parsed.data;
}
export function createGoalMeasurementsRepository(database: Pick<LifeosDatabase, "select" | "insert" | "update" | "delete">, options: { lockRows?: boolean } = {}): GoalMeasurementsRepository {
  const order = [desc(goalMeasurements.measuredAt), desc(goalMeasurements.createdAt), desc(goalMeasurements.id)];
  return {
    async create(actor, goal, input) {
      const [row] = await database.insert(goalMeasurements).values({ userId: actor.userId, goalId: goal.id, unit: goal.unit,
        value: input.value, measuredAt: new Date(input.measured_at), source: input.source, note: input.note }).returning();
      if (!row) throw new Error("Measurement insert returned no row.");
      return toGoalMeasurement(row);
    },
    async find(actor, id) {
      const query = database.select().from(goalMeasurements).where(ownedBy(goalMeasurements.userId, actor, eq(goalMeasurements.id, id))).limit(1);
      const [row] = await (options.lockRows ? query.for("update") : query);
      return row ? toGoalMeasurement(row) : null;
    },
    async update(actor, id, input) {
      const [row] = await database.update(goalMeasurements).set({ value: input.value,
        measuredAt: input.measured_at === undefined ? undefined : new Date(input.measured_at), note: input.note, updatedAt: sql`clock_timestamp()` })
        // An example value is never corrected into the person's data (LFS-218); the service also refuses it.
        .where(ownedBy(goalMeasurements.userId, actor, eq(goalMeasurements.id, id), ne(goalMeasurements.source, "example"))).returning();
      return row ? toGoalMeasurement(row) : null;
    },
    async remove(actor, id) {
      const [row] = await database.delete(goalMeasurements).where(ownedBy(goalMeasurements.userId, actor, eq(goalMeasurements.id, id))).returning();
      return row ? toGoalMeasurement(row) : null;
    },
    async removeExamples(actor, goalId) {
      const rows = await database.delete(goalMeasurements)
        .where(ownedBy(goalMeasurements.userId, actor, eq(goalMeasurements.goalId, goalId), eq(goalMeasurements.source, "example"))).returning();
      return rows.map(toGoalMeasurement).sort((a, b) => b.measured_at.localeCompare(a.measured_at) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    },
    async list(actor, goalId) {
      const rows = await database.select().from(goalMeasurements).where(ownedBy(goalMeasurements.userId, actor, eq(goalMeasurements.goalId, goalId))).orderBy(...order).limit(100);
      return rows.map(toGoalMeasurement);
    },
  };
}
