import { fork, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { getUninstallPlans } from "pg-boss";
import type { PgBoss } from "pg-boss";
import { createDatabase, databaseErrorMessage, readTestDatabaseUrl } from "@lifeos/db";
import type { DatabaseClient } from "@lifeos/db";
import { DEMO_POLICY, DEMO_QUEUE } from "../../src/jobs/demo-ping.ts";
import type { DemoMode } from "../../src/jobs/demo-ping.ts";
import { createQueueClient, ensureDemoQueue } from "../../src/queue.ts";

const schema = `lfs105_queue_${randomUUID().replaceAll("-", "")}`;
if (!/^lfs105_queue_[a-f0-9]{32}$/.test(schema)) throw new Error("Invalid isolated queue schema.");
let administration: DatabaseClient | undefined;
let observer: PgBoss | undefined;
let connectionString: string;
let owned = false;
type Child = { process: ChildProcess; events: Record<string, unknown>[]; stderr: string; exit: Promise<number | null>; code: number | null | undefined };
const children: Child[] = [];

async function databaseOperation<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { throw new Error(databaseErrorMessage(error)); }
}

async function until<T>(probe: () => Promise<T> | T, accept: (value: T) => boolean, timeout = 20_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await probe();
    if (accept(value)) return value;
    await delay(100);
  }
  throw new Error("Timed out waiting for an observable worker/database condition.");
}

function track(process: ChildProcess): Child {
  const child: Child = { process, events: [], stderr: "", code: undefined, exit: Promise.resolve(null) };
  let buffer = "";
  process.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      try { child.events.push(JSON.parse(line) as Record<string, unknown>); } catch { /* Not a structured worker event. */ }
    }
  });
  process.stderr?.on("data", (chunk: Buffer) => { child.stderr += chunk.toString(); });
  child.exit = new Promise((resolve) => {
    process.once("error", () => { child.code = 1; resolve(1); });
    process.once("close", (code) => { child.code = code; resolve(code); });
  });
  children.push(child);
  return child;
}

const environment = () => ({ ...process.env, DATABASE_URL: connectionString, WORKER_QUEUE_SCHEMA: schema });
const hasEvent = (child: Child, event: string) => child.events.some((entry) => entry.event === event);

async function startWorker(hold = false): Promise<Child> {
  const child = track(fork(fileURLToPath(new URL("../fixtures/worker-process.ts", import.meta.url)), [], {
    execArgv: [], env: { ...environment(), LFS105_TEST_HOLD: hold ? "1" : "0" }, stdio: ["ignore", "pipe", "pipe", "ipc"],
  }));
  await until(() => {
    if (child.code !== undefined) throw new Error("Worker exited before readiness.");
    return hasEvent(child, "worker.ready");
  }, Boolean);
  return child;
}

function signal(child: Child, name: "SIGINT" | "SIGTERM"): void {
  // Node on Windows kill(SIGTERM) is forceful. Emit its registered signal in the test-only fixture.
  if (process.platform === "win32") child.process.send(name);
  else child.process.kill(name);
}

async function stopWorker(child: Child, name: "SIGINT" | "SIGTERM"): Promise<void> {
  signal(child, name);
  await until(() => child.code, (value) => value !== undefined);
  expect(await child.exit).toBe(0);
  expect(hasEvent(child, "worker.stopped")).toBe(true);
  const sessions = await databaseOperation(() => administration!.pool.query<{ count: number }>("SELECT count(*)::int AS count FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND application_name = 'lifeos-worker' AND datname = current_database() AND client_port IS NOT NULL"));
  expect(sessions.rows[0]?.count).toBe(0);
  expect(child.stderr).toBe("");
}

async function waitForJob(id: string, state: "completed" | "failed") {
  return until(() => databaseOperation(() => observer!.findJobs<unknown>(DEMO_QUEUE, { id, limit: 1 })), (jobs) => jobs[0]?.state === state);
}

beforeAll(async () => {
  await databaseOperation(async () => {
    connectionString = readTestDatabaseUrl(process.env);
    administration = createDatabase({ connectionString });
    // Reserve atomically: never take ownership of a pre-existing namespace.
    await administration.pool.query(`CREATE SCHEMA "${schema}"`);
    owned = true;
    observer = createQueueClient({ connectionString, schema }, () => {}, "producer");
    await observer.start();
    await ensureDemoQueue(observer);
  });
});

afterAll(async () => {
  for (const child of children) {
    if (child.code === undefined) { child.process.kill("SIGKILL"); await child.exit; }
  }
  await databaseOperation(async () => {
    try {
      await observer?.stop({ close: true, graceful: true, timeout: 10_000 });
      if (administration && owned) {
        // Official uninstall removes only pg-boss objects in this run's reserved schema.
        await administration.pool.query(getUninstallPlans(schema));
        await administration.pool.query(`DROP SCHEMA "${schema}"`);
      }
    } finally { await administration?.close(); }
  });
});

it("runs the CLI producer in its own process and confirms completed output in PostgreSQL", async () => {
  const worker = await startWorker();
  try {
    const producer = track(spawn(process.execPath, ["src/producer.ts"], { cwd: fileURLToPath(new URL("../../", import.meta.url)), env: environment(), stdio: ["ignore", "pipe", "pipe"] }));
    await until(() => producer.code, (value) => value !== undefined);
    expect(await producer.exit).toBe(0);
    expect(producer.stderr).toBe("");
    const queued = producer.events.find((event) => event.status === "queued");
    expect(queued?.job_id).toBeTypeOf("string");
    const [job] = await waitForJob(String(queued?.job_id), "completed");
    expect(queued?.request_id).toBe(queued?.correlation_id);
    expect(job?.output).toEqual({ request_id: queued?.request_id, correlation_id: queued?.correlation_id, status: "pong" });
    console.log(JSON.stringify({ job_id: job?.id, status: job?.state }));
  } finally { await stopWorker(worker, "SIGTERM"); }
});

it("retries with delay/backoff and exhausts a repeatable failure after three attempts", async () => {
  const worker = await startWorker();
  try {
    for (const mode of ["fail-once", "always-fail"] satisfies DemoMode[]) {
      const id = await databaseOperation(() => observer!.send(DEMO_QUEUE, { correlationId: randomUUID(), mode }, DEMO_POLICY));
      if (!id) throw new Error("Expected a queued demo job.");
      const [job] = await waitForJob(id, mode === "always-fail" ? "failed" : "completed");
      expect(job).toMatchObject({ retryLimit: 2, retryDelay: 1, retryBackoff: true, retryCount: mode === "always-fail" ? 2 : 1 });
      const attempts = worker.events.filter((event) => event.job_id === id);
      expect(attempts).toHaveLength(mode === "always-fail" ? 3 : 2);
      expect(attempts.map((event) => event.attempt)).toEqual(mode === "always-fail" ? [1, 2, 3] : [1, 2]);
      expect(job!.startedOn.getTime() - job!.createdOn.getTime()).toBeGreaterThanOrEqual(400);
      console.log(JSON.stringify({ job_id: id, status: job?.state, attempts: attempts.length }));
    }
  } finally { await stopWorker(worker, "SIGTERM"); }
});

it("drains an active handler on SIGINT before closing its PostgreSQL connections", async () => {
  const worker = await startWorker(true);
  const id = await databaseOperation(() => observer!.send(DEMO_QUEUE, { correlationId: randomUUID(), mode: "ok" }, DEMO_POLICY));
  if (!id) throw new Error("Expected a queued demo job.");
  await until(() => hasEvent(worker, "test.active"), Boolean);
  signal(worker, "SIGINT");
  await until(() => hasEvent(worker, "worker.stopping"), Boolean);
  expect(hasEvent(worker, "worker.stopped")).toBe(false);
  expect(worker.code).toBeUndefined();
  worker.process.send("release");
  await until(() => worker.code, (value) => value !== undefined);
  expect(await worker.exit).toBe(0);
  const [job] = await waitForJob(id, "completed");
  expect(job?.state).toBe("completed");
  expect(hasEvent(worker, "worker.stopped")).toBe(true);
  const sessions = await databaseOperation(() => administration!.pool.query<{ count: number }>("SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = 'lifeos-worker' AND datname = current_database()"));
  expect(sessions.rows[0]?.count).toBe(0);
  console.log(JSON.stringify({ job_id: id, status: job?.state, shutdown: "drained" }));
});

it("rejects invalid process configuration without exposing credentials", async () => {
  const child = track(spawn(process.execPath, ["dist/index.js"], { cwd: fileURLToPath(new URL("../../", import.meta.url)), env: { ...environment(), DATABASE_URL: "https://private:do-not-log@localhost/lifeos" }, stdio: ["ignore", "pipe", "pipe"] }));
  await until(() => child.code, (value) => value !== undefined);
  expect(await child.exit).toBe(1);
  expect(child.events).toEqual([{ event: "worker.error", status: "failed", code: "STARTUP_FAILED", invalid_settings: ["DATABASE_URL"] }]);
  expect(JSON.stringify(child.events) + child.stderr).not.toContain("do-not-log");
});

it("exits after an unavailable database without leaving a live pool or leaking its URL", async () => {
  const child = track(spawn(process.execPath, ["dist/index.js"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    env: { ...environment(), DATABASE_URL: "postgresql://fixture:do-not-log@127.0.0.1:1/lifeos" },
    stdio: ["ignore", "pipe", "pipe"],
  }));
  await until(() => child.code, (value) => value !== undefined);
  expect(await child.exit).toBe(1);
  expect(child.events).toContainEqual({ event: "worker.error", status: "failed", code: "STARTUP_FAILED" });
  expect(child.events.at(-1)).toEqual({ event: "worker.stopped", status: "stopped" });
  expect(JSON.stringify(child.events) + child.stderr).not.toContain("do-not-log");
});
