import { eq, sql } from "drizzle-orm";
import { goalSchema } from "@lifeos/contracts";
import type { Goal } from "@lifeos/contracts";
import type { GoalsRepository } from "@lifeos/domain";
import type { LifeosDatabase } from "../client.ts";
import { ownedBy } from "../ownership.ts";
import { goals } from "../schema/goals.ts";

// Unconstrained numeric preserves display scale from SQL inserts. Insignificant zeros may exceed
// the input contract's lexical scale while the stored value still satisfies all precision CHECKs.
function storedDecimal(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

export function toGoal(row: typeof goals.$inferSelect): Goal {
  const parsed = goalSchema.safeParse({
    id: row.id, user_id: row.userId, domain_key: row.domainKey, title: row.title, description: row.description,
    unit: row.unit, unit_label: row.unitLabel, baseline: storedDecimal(row.baseline), target: storedDecimal(row.target), direction: row.direction,
    calculation_mode: row.calculationMode, metric_key: row.metricKey, status: row.status,
    due_at: row.dueAt?.toISOString() ?? null, created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString(),
  });
  if (!parsed.success) throw new Error("Invalid stored goal.");
  return parsed.data;
}

/** Accepts a database or a transaction-bound adapter; audit composition belongs to LFS-210. */
export function createGoalsRepository(database: Pick<LifeosDatabase, "select" | "insert" | "update">, options: { lockRows?: boolean } = {}): GoalsRepository {
  const repository: GoalsRepository = {
    async create(actor, input) {
      const [row] = await database.insert(goals).values({
        userId: actor.userId, domainKey: input.domain_key, title: input.title, description: input.description,
        unit: input.unit, unitLabel: input.unit_label, baseline: input.baseline, target: input.target,
        direction: input.direction, calculationMode: input.calculation_mode, metricKey: input.metric_key,
        status: "active", dueAt: input.due_at === null ? null : new Date(input.due_at),
      }).returning();
      if (!row) throw new Error("Goal insert returned no row.");
      return toGoal(row);
    },
    async find(actor, id) {
      const query = database.select().from(goals).where(ownedBy(goals.userId, actor, eq(goals.id, id))).limit(1);
      const [row] = await (options.lockRows ? query.for("update") : query);
      return row ? toGoal(row) : null;
    },
    async updateActive(actor, id, input) {
      const [row] = await database.update(goals).set({
        title: input.title, description: input.description,
        dueAt: input.due_at === undefined ? undefined : input.due_at === null ? null : new Date(input.due_at),
        updatedAt: sql`clock_timestamp()`,
      }).where(ownedBy(goals.userId, actor, eq(goals.id, id), eq(goals.status, "active"))).returning();
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
