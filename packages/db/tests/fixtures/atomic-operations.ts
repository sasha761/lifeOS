import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { eq, sql } from "drizzle-orm";
import { integer, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { fromDrizzle } from "pg-boss";
import type { PgBoss, QueueOptions } from "pg-boss";
import { z } from "zod";
import { demoPingPayloadSchema, idempotencyKeySchema, identifierSchema } from "@lifeos/contracts";
import type { DemoPayload } from "@lifeos/contracts";
import { databaseErrorMessage } from "../../src/configuration.ts";
import type { LifeosDatabase } from "../../src/client.ts";

export const operationInputSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema, payload: demoPingPayloadSchema,
});
export type OperationInput = z.infer<typeof operationInputSchema>;
const deliverySchema = z.object({ id: identifierSchema, data: demoPingPayloadSchema });
export type FixtureTransaction = Parameters<Parameters<LifeosDatabase["transaction"]>[0]>[0];

export const FIXTURE_POLICY = {
  retryLimit: 2, retryDelay: 1, retryBackoff: true, retryDelayMax: 10,
  expireInSeconds: 30, retentionSeconds: 86_400, deleteAfterSeconds: 86_400,
} satisfies QueueOptions;

export function fixtureTable(schemaName: string) {
  if (schemaName.length !== "lfs107_atomic_".length + 32 || !/^lfs107_atomic_[a-f0-9]{32}$/.test(schemaName)) {
    throw new Error("Invalid atomicity test namespace.");
  }
  return pgSchema(schemaName).table("foundation_test_operations", {
    id: uuid("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").$type<DemoPayload>().notNull(),
    queueName: text("queue_name").notNull(),
    jobId: uuid("job_id").notNull().unique(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    effectCount: integer("effect_count").notNull().default(0),
  });
}
export type FixtureTable = ReturnType<typeof fixtureTable>;
export type FixtureOperation = FixtureTable["$inferSelect"];
export type OperationResult = { operationId: string; jobId: string; created: boolean };

const messages = {
  INVALID_INPUT: "Invalid foundation fixture input.",
  CONFLICT: "Idempotency key was already used for a different fixture action.",
  ENQUEUE_REJECTED: "Fixture enqueue did not return the expected job ID.",
  MISSING_OPERATION: "Fixture operation was not found.",
  FORCED_ROLLBACK: "Forced foundation fixture rollback.",
} as const;
export class AtomicFixtureError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
    this.name = "AtomicFixtureError";
  }
}

export async function checkedDatabaseOperation<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error: unknown) {
    if (error instanceof AtomicFixtureError) throw error;
    throw new Error(databaseErrorMessage(error));
  }
}

// All code in this module is test-only; hooks allow observations before COMMIT/ROLLBACK.
export function createAtomicFixture(database: LifeosDatabase, boss: PgBoss, table: FixtureTable, queueName: string) {
  return {
    async enqueue(input: unknown, hooks: {
      beforeInsert?: (tx: FixtureTransaction) => Promise<void>;
      afterInsert?: (tx: FixtureTransaction, operation: FixtureOperation) => Promise<void>;
      afterEnqueue?: (tx: FixtureTransaction, operation: FixtureOperation) => Promise<void>;
    } = {}): Promise<OperationResult> {
      const parsed = operationInputSchema.safeParse(input);
      if (!parsed.success) throw new AtomicFixtureError("INVALID_INPUT");
      const { idempotencyKey, payload } = parsed.data;
      return checkedDatabaseOperation(() => database.transaction(async (tx) => {
        await hooks.beforeInsert?.(tx);
        const [inserted] = await tx.insert(table).values({
          id: randomUUID(), idempotencyKey, payload, queueName, jobId: randomUUID(),
        }).onConflictDoNothing({ target: table.idempotencyKey }).returning();

        if (!inserted) {
          // At READ COMMITTED a fresh statement sees the committed winner after unique-key contention.
          const [existing] = await tx.select().from(table).where(eq(table.idempotencyKey, idempotencyKey));
          if (!existing) throw new AtomicFixtureError("MISSING_OPERATION");
          // Trace metadata can change on an HTTP retry; the fixture action is queue + mode.
          if (existing.queueName !== queueName || existing.payload.mode !== payload.mode) throw new AtomicFixtureError("CONFLICT");
          return { operationId: existing.id, jobId: existing.jobId, created: false };
        }

        await hooks.afterInsert?.(tx, inserted);
        const jobId = await boss.send(queueName, payload, {
          ...FIXTURE_POLICY, id: inserted.jobId, db: fromDrizzle(tx, sql),
        });
        // null from send is not success: roll back the fixture row too.
        if (jobId !== inserted.jobId) throw new AtomicFixtureError("ENQUEUE_REJECTED");
        await hooks.afterEnqueue?.(tx, inserted);
        return { operationId: inserted.id, jobId, created: true };
      }, { isolationLevel: "read committed" }));
    },

    async consume(delivery: unknown, hooks: {
      afterEffect?: (tx: FixtureTransaction) => Promise<void>;
    } = {}): Promise<{ applied: boolean }> {
      const parsed = deliverySchema.safeParse(delivery);
      if (!parsed.success) throw new AtomicFixtureError("INVALID_INPUT");
      return checkedDatabaseOperation(() => database.transaction(async (tx) => {
        const [operation] = await tx.select().from(table).where(eq(table.jobId, parsed.data.id)).for("update");
        if (!operation || operation.queueName !== queueName) throw new AtomicFixtureError("MISSING_OPERATION");
        if (!isDeepStrictEqual(operation.payload, parsed.data.data)) throw new AtomicFixtureError("CONFLICT");
        if (operation.processedAt) return { applied: false };
        // The SQL effect and its durable marker commit/roll back together under the row lock.
        await tx.update(table).set({ effectCount: sql`${table.effectCount} + 1`, processedAt: sql`now()` }).where(eq(table.id, operation.id));
        await hooks.afterEffect?.(tx);
        return { applied: true };
      }, { isolationLevel: "read committed" }));
    },
  };
}
