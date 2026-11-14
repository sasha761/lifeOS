import { randomUUID } from "node:crypto";
import { createDemoPayload } from "@lifeos/contracts";
import { describe, expect, it, vi } from "vitest";
import { readWorkerConfiguration } from "../../src/configuration.ts";
import { handleDemoPing, parseDemoPayload } from "../../src/jobs/demo-ping.ts";
import { runWorkerProcess } from "../../src/process.ts";

describe("worker configuration", () => {
  it("rejects invalid env before constructing a runtime and logs only setting names", async () => {
    const exitCode = process.exitCode;
    vi.stubEnv("DATABASE_URL", "do-not-log");
    const create = vi.fn();
    const log = vi.fn();
    try {
      await runWorkerProcess(log, create);
      expect(create).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(log).toHaveBeenCalledExactlyOnceWith({ event: "worker.error", status: "failed", code: "STARTUP_FAILED", invalid_settings: ["DATABASE_URL"] });
      expect(JSON.stringify(log.mock.calls)).not.toContain("do-not-log");
    } finally {
      process.exitCode = exitCode;
      vi.unstubAllEnvs();
    }
  });
  it("uses an explicit database and a dedicated default schema", () => {
    expect(readWorkerConfiguration({ DATABASE_URL: "postgresql://localhost/lifeos" })).toEqual({ connectionString: "postgresql://localhost/lifeos", schema: "pgboss" });
  });
  it("accepts an isolated queue schema", () => {
    expect(readWorkerConfiguration({ DATABASE_URL: "postgresql://localhost/lifeos_test", WORKER_QUEUE_SCHEMA: "lfs105_queue_fixture" }).schema).toBe("lfs105_queue_fixture");
  });
  it.each([undefined, "", "https://private:do-not-log@localhost/lifeos"])("rejects invalid database configuration %#", (DATABASE_URL) => {
    expect(() => readWorkerConfiguration({ DATABASE_URL })).toThrow();
    try { readWorkerConfiguration({ DATABASE_URL }); } catch (error) { expect(String(error)).not.toContain("do-not-log"); }
  });
  it.each(["", "public", "drizzle", "pg_catalog", "MixedCase", "jobs;do-not-log", "a".repeat(51)])("rejects an unsafe schema %#", (WORKER_QUEUE_SCHEMA) => {
    expect(() => readWorkerConfiguration({ DATABASE_URL: "postgresql://localhost/lifeos", WORKER_QUEUE_SCHEMA })).toThrow("WORKER_QUEUE_SCHEMA must be");
  });
});

describe("demo.ping boundary", () => {
  const id = randomUUID();
  const correlationId = randomUUID();
  it("preserves HTTP identifiers through payload validation, processing and logging", async () => {
    const context = { request_id: randomUUID(), correlation_id: correlationId };
    const log = vi.fn();
    await expect(handleDemoPing({ id, retryCount: 0, data: createDemoPayload("ok", context) }, log)).resolves.toEqual({ ...context, status: "pong" });
    expect(log).toHaveBeenCalledExactlyOnceWith({ event: "demo.ping", status: "processed", job_id: id, ...context, attempt: 1 });
  });
  it("returns a measurable result and logs only technical identifiers", async () => {
    const log = vi.fn();
    await expect(handleDemoPing({ id, retryCount: 0, data: { correlationId, mode: "ok" } }, log)).resolves.toEqual({ correlation_id: correlationId, status: "pong" });
    expect(log).toHaveBeenCalledExactlyOnceWith({ event: "demo.ping", status: "processed", job_id: id, correlation_id: correlationId, attempt: 1 });
  });
  it("fails once and succeeds on the next attempt", async () => {
    const job = { id, data: { correlationId, mode: "fail-once" } };
    await expect(handleDemoPing({ ...job, retryCount: 0 }, vi.fn())).rejects.toThrow("Expected demo.ping failure.");
    await expect(handleDemoPing({ ...job, retryCount: 1 }, vi.fn())).resolves.toMatchObject({ status: "pong" });
  });
  it("keeps repeatable failures visible to pg-boss", async () => {
    await expect(handleDemoPing({ id, retryCount: 2, data: { correlationId, mode: "always-fail" } }, vi.fn())).rejects.toThrow("Expected demo.ping failure.");
  });
  it.each([null, 42, [], {}, { correlationId: "do-not-log", mode: "ok" }, { correlationId, mode: "unknown" }, { correlationId, mode: "ok", secret: "do-not-log" }])("rejects unknown input safely %#", async (data) => {
    const log = vi.fn();
    expect(() => parseDemoPayload(data)).toThrow("Invalid demo.ping payload.");
    await expect(handleDemoPing({ id, retryCount: 0, data }, log)).rejects.toThrow("Invalid demo.ping payload.");
    expect(JSON.stringify(log.mock.calls)).not.toContain("do-not-log");
  });
});
