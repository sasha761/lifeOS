import { asc, eq, inArray, sql } from "drizzle-orm";
import type { StarterPackRepository } from "@lifeos/domain";
import type { LifeosDatabase } from "../client.ts";
import { ownedBy } from "../ownership.ts";
import { goalMeasurements } from "../schema/goal-measurements.ts";
import { goals } from "../schema/goals.ts";

function count(value: string | undefined): number {
  const result = Number(value ?? "0");
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("Invalid stored example count.");
  return result;
}

/** Owner-scoped example goals (LFS-218); used inside the example command transaction only. */
export function createStarterPackRepository(database: Pick<LifeosDatabase, "select" | "delete">): StarterPackRepository {
  return {
    async countExamples(actor) {
      const [row] = await database.select({ total: sql<string>`count(*)::text` }).from(goals)
        .where(ownedBy(goals.userId, actor, eq(goals.origin, "starter")));
      return count(row?.total);
    },
    async deleteExamples(actor) {
      // Parent rows first, in a stable order, as every measurement write does (ADR-008); then the cascade.
      const locked = await database.select({ id: goals.id }).from(goals)
        .where(ownedBy(goals.userId, actor, eq(goals.origin, "starter"))).orderBy(asc(goals.id)).for("update");
      if (locked.length === 0) return { goals: 0, measurements: 0 };
      const ids = locked.map((row) => row.id);
      const [measured] = await database.select({ total: sql<string>`count(*)::text` }).from(goalMeasurements)
        .where(ownedBy(goalMeasurements.userId, actor, inArray(goalMeasurements.goalId, ids)));
      const deleted = await database.delete(goals)
        .where(ownedBy(goals.userId, actor, inArray(goals.id, ids), eq(goals.origin, "starter"))).returning({ id: goals.id });
      if (deleted.length !== ids.length) throw new Error("Example goals changed under the lock.");
      return { goals: deleted.length, measurements: count(measured?.total) };
    },
  };
}
