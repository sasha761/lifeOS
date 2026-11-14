import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { fromDrizzle, getUninstallPlans, PgBoss } from "pg-boss";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createDemoPayload } from "@lifeos/contracts";
import type { DemoPayload } from "@lifeos/contracts";
import { createDatabase, readTestDatabaseUrl } from "../../src/index.ts";
import type { DatabaseClient } from "../../src/index.ts";
import { AtomicFixtureError, checkedDatabaseOperation, createAtomicFixture, fixtureTable, FIXTURE_POLICY } from "../fixtures/atomic-operations.ts";
import type { FixtureTransaction, OperationInput } from "../fixtures/atomic-operations.ts";

const schemaName = `lfs107_atomic_${randomUUID().replaceAll("-", "")}`;
const table = fixtureTable(schemaName); // Validates before SQL identifier interpolation.
const identifier = `"${schemaName}"`;
let observer: DatabaseClient | undefined;
let writer: DatabaseClient | undefined;
let boss: PgBoss;
let queueName: string;
let fixture: ReturnType<typeof createAtomicFixture>;
let owned = false;
const queueErrors: string[] = [];

function command(key: string = randomUUID()): OperationInput {
  const requestId = randomUUID();
  return { idempotencyKey: key, payload: createDemoPayload("ok", { request_id: requestId, correlation_id: requestId }) };
}

async function visible(key: string, queue = queueName) {
  return checkedDatabaseOperation(async () => ({
    operations: await observer!.db.select().from(table).where(eq(table.idempotencyKey, key)),
    jobs: await boss.findJobs<DemoPayload>(queue),
  }));
}

async function transactionIdentity(tx: FixtureTransaction) {
  const query = "SELECT pg_backend_pid() AS pid, txid_current()::text AS xid";
  const direct = await tx.execute<{ pid: number; xid: string }>(sql`SELECT pg_backend_pid() AS pid, txid_current()::text AS xid`);
  const adapted = await fromDrizzle(tx, sql).executeSql(query, []);
  return { direct: direct.rows[0], adapted: adapted.rows[0] };
}

beforeAll(async () => {
  await checkedDatabaseOperation(async () => {
    const connectionString = readTestDatabaseUrl(process.env);
    observer = createDatabase({ connectionString });
    writer = createDatabase({ connectionString });
    // Reserve without IF NOT EXISTS: never claim an existing namespace.
    await observer.pool.query(`CREATE SCHEMA ${identifier}`);
    owned = true;
    const ddl = await readFile(new URL("../fixtures/atomicity.sql", import.meta.url), "utf8");
    await observer.pool.query(ddl.replaceAll("__SCHEMA__", schemaName));
    boss = new PgBoss({
      connectionString, schema: schemaName, schedule: false, supervise: false,
      max: 2, connectionTimeoutMillis: 5_000, openTelemetry: { enabled: false },
    });
    boss.on("error", () => queueErrors.push("QUEUE_ERROR"));
    await boss.start();
  });
});

beforeEach(async () => {
  queueName = `demo.ping.${randomUUID()}`;
  await checkedDatabaseOperation(() => boss.createQueue(queueName, FIXTURE_POLICY));
  fixture = createAtomicFixture(writer!.db, boss, table, queueName);
});

afterAll(async () => {
  await checkedDatabaseOperation(async () => {
    try {
      await boss?.stop({ graceful: true, close: true, timeout: 10_000 });
      if (observer && owned) {
        // Official SQL removes only this run's pg-boss objects; no CASCADE or database/volume deletion.
        await observer.pool.query(getUninstallPlans(schemaName));
        await observer.pool.query(`DROP TABLE IF EXISTS ${identifier}.foundation_test_operations`);
        await observer.pool.query(`DROP SCHEMA ${identifier}`);
        const remaining = await observer.pool.query<{ count: number }>("SELECT count(*)::int AS count FROM pg_namespace WHERE nspname = $1", [schemaName]);
        expect(remaining.rows[0]?.count).toBe(0);
      }
    } finally {
      await Promise.all([writer?.close(), observer?.close()]);
    }
  });
  expect(queueErrors).toEqual([]);
});

it("commit: row and job share the transaction and become visible together", async () => {
  const input = command();
  let identity: Awaited<ReturnType<typeof transactionIdentity>> | undefined;
  let insideRowCount = 0;
  let insideJobCount = 0;
  let outside: Awaited<ReturnType<typeof visible>> | undefined;
  const result = await fixture.enqueue(input, { afterEnqueue: async (tx, operation) => {
    identity = await transactionIdentity(tx);
    insideRowCount = (await tx.select().from(table).where(eq(table.id, operation.id))).length;
    insideJobCount = (await boss.findJobs(queueName, { id: operation.jobId, db: fromDrizzle(tx, sql) })).length;
    outside = await visible(input.idempotencyKey);
  } });
  expect(identity?.direct).toEqual(identity?.adapted);
  expect(identity?.direct?.pid).toBeTypeOf("number");
  expect(insideRowCount).toBe(1);
  expect(insideJobCount).toBe(1);
  expect(outside).toEqual({ operations: [], jobs: [] });
  const committed = await visible(input.idempotencyKey);
  expect(result.created).toBe(true);
  expect(committed.operations).toHaveLength(1);
  expect(committed.jobs).toHaveLength(1);
  expect(committed.operations[0]).toMatchObject({ id: result.operationId, jobId: result.jobId, payload: input.payload, effectCount: 0 });
  expect(committed.operations[0].createdAt).toBeInstanceOf(Date);
  expect(committed.jobs[0]).toMatchObject({ id: result.jobId, state: "created", data: input.payload });
});

it("rollback: an error after enqueue removes both writes and leaves the key reusable", async () => {
  const input = command();
  let enqueuedId: string | undefined;
  let insideJobCount = 0;
  await expect(fixture.enqueue(input, { afterEnqueue: async (tx, operation) => {
    enqueuedId = operation.jobId;
    insideJobCount = (await boss.findJobs(queueName, { id: operation.jobId, db: fromDrizzle(tx, sql) })).length;
    throw new AtomicFixtureError("FORCED_ROLLBACK");
  } })).rejects.toMatchObject({ code: "FORCED_ROLLBACK" });
  expect(insideJobCount).toBe(1);
  expect(await visible(input.idempotencyKey)).toEqual({ operations: [], jobs: [] });
  expect(await checkedDatabaseOperation(() => boss.findJobs(queueName, { id: enqueuedId }))).toEqual([]);
  const retried = await fixture.enqueue(input);
  expect(retried.created).toBe(true);
  expect(retried.jobId).not.toBe(enqueuedId);
  expect((await visible(input.idempotencyKey)).jobs).toHaveLength(1);
});

it("sequential dedupe: a retry with new trace metadata returns the original row and job", async () => {
  const input = command();
  const first = await fixture.enqueue(input);
  const duplicate = await fixture.enqueue(command(input.idempotencyKey));
  expect(duplicate).toEqual({ ...first, created: false });
  const state = await visible(input.idempotencyKey);
  expect(state.operations).toHaveLength(1);
  expect(state.jobs).toHaveLength(1);
  expect(state.jobs[0].data).toEqual(input.payload);
});

it("concurrent dedupe: two live PostgreSQL transactions produce one row and one job", async () => {
  const input = command();
  const barrier = Promise.withResolvers<void>();
  const pids: number[] = [];
  const beforeInsert = async (tx: FixtureTransaction) => {
    const identity = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
    pids.push(identity.rows[0].pid);
    if (pids.length === 2) barrier.resolve();
    // Both real connections enter their transactions before either INSERT. No sleep/polling.
    await barrier.promise;
  };
  const attempts = [
    fixture.enqueue(input, { beforeInsert }),
    fixture.enqueue(command(input.idempotencyKey), { beforeInsert }),
  ].map((attempt) => attempt.catch((error: unknown) => {
    barrier.resolve(); // Release the other connection even if one transaction fails before the barrier.
    throw error;
  }));
  const settled = await Promise.allSettled(attempts);
  const results = settled.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
  expect(new Set(pids).size).toBe(2);
  expect(results.filter((result) => result.created)).toHaveLength(1);
  expect(results[0].operationId).toBe(results[1].operationId);
  expect(results[0].jobId).toBe(results[1].jobId);
  const state = await visible(input.idempotencyKey);
  expect(state.operations).toHaveLength(1);
  expect(state.jobs).toHaveLength(1);
});

it("rejects a reused key with a different action without creating another job", async () => {
  const input = command();
  await fixture.enqueue(input);
  await expect(fixture.enqueue({ ...input, payload: { ...input.payload, mode: "fail-once" } })).rejects.toMatchObject({ code: "CONFLICT" });
  const state = await visible(input.idempotencyKey);
  expect(state.operations).toHaveLength(1);
  expect(state.jobs).toHaveLength(1);
  expect(state.jobs[0].data.mode).toBe("ok");
});

it.each(["key", "payload"])("rejects malformed %s before any durable write", async (field) => {
  const input = command();
  const invalid = field === "key" ? { ...input, idempotencyKey: "do-not-log\n" } : { ...input, payload: { ...input.payload, secret: "do-not-log" } };
  await expect(fixture.enqueue(invalid)).rejects.toThrow("Invalid foundation fixture input.");
  expect(await visible(input.idempotencyKey)).toEqual({ operations: [], jobs: [] });
});

it("rolls back the fixture row when PostgreSQL rejects enqueue to a missing queue", async () => {
  const input = command();
  const missingQueue = `missing.${randomUUID()}`;
  const missing = createAtomicFixture(writer!.db, boss, table, missingQueue);
  await expect(missing.enqueue(input)).rejects.toThrow("Database operation failed");
  expect(await visible(input.idempotencyKey)).toEqual({ operations: [], jobs: [] });
});

it("treats a real null send result as failure and rolls back the new operation", async () => {
  const input = command();
  let existingJobId: string | null = null;
  await expect(fixture.enqueue(input, { afterInsert: async (_tx, operation) => {
    // Deliberate pre-existing job outside the tested transaction forces a duplicate-ID null result.
    existingJobId = await boss.send(queueName, input.payload, { ...FIXTURE_POLICY, id: operation.jobId });
  } })).rejects.toMatchObject({ code: "ENQUEUE_REJECTED" });
  expect(existingJobId).toBeTypeOf("string");
  const state = await visible(input.idempotencyKey);
  expect(state.operations).toEqual([]);
  expect(state.jobs.map((job) => job.id)).toEqual([existingJobId]);
});

it("consumer: effect rollback is retryable; redelivery after commit does not repeat the SQL effect", async () => {
  const input = command();
  const result = await fixture.enqueue(input);
  const [delivery] = await checkedDatabaseOperation(() => boss.fetch<DemoPayload>(queueName));
  expect(delivery.id).toBe(result.jobId);
  await expect(fixture.consume(delivery, { afterEffect: async () => { throw new AtomicFixtureError("FORCED_ROLLBACK"); } })).rejects.toMatchObject({ code: "FORCED_ROLLBACK" });
  expect((await visible(input.idempotencyKey)).operations[0]).toMatchObject({ effectCount: 0, processedAt: null });
  expect(await fixture.consume(delivery)).toEqual({ applied: true });
  // Replay the captured delivery before acknowledgment: models crash-after-effect/before-ack.
  expect(await fixture.consume(delivery)).toEqual({ applied: false });
  await checkedDatabaseOperation(() => boss.complete(queueName, delivery, { status: "fixture-applied" }));
  const state = await visible(input.idempotencyKey);
  expect(state.operations[0].effectCount).toBe(1);
  expect(state.operations[0].processedAt).toBeInstanceOf(Date);
  expect(state.jobs[0].state).toBe("completed");
});

it("consumer: concurrent redelivery applies the durable SQL effect once", async () => {
  const input = command();
  await fixture.enqueue(input);
  const [delivery] = await checkedDatabaseOperation(() => boss.fetch<DemoPayload>(queueName));
  const results = await Promise.all([fixture.consume(delivery), fixture.consume(delivery)]);
  expect(results.map((result) => result.applied).sort()).toEqual([false, true]);
  expect((await visible(input.idempotencyKey)).operations[0].effectCount).toBe(1);
});
