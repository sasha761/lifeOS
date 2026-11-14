import { describe, expect, it } from "vitest";
import { EnvironmentConfigurationError, parseDatabaseUrl, readDatabaseEnv, readWebEnv, readWorkerEnv } from "../src/env.ts";

const DATABASE_URL = "postgresql://fixture:do-not-log@127.0.0.1:15432/lifeos";

describe("explicit environment validation", () => {
  it("validates database, web and worker independently with safe defaults", () => {
    expect(readDatabaseEnv({ DATABASE_URL })).toEqual({ DATABASE_URL });
    expect(readWebEnv({ DATABASE_URL, NODE_ENV: "production", WORKER_QUEUE_SCHEMA: "invalid!", SECRET: "private" }))
      .toEqual({ DATABASE_URL, NODE_ENV: "production" });
    expect(readWorkerEnv({ DATABASE_URL })).toEqual({ DATABASE_URL, NODE_ENV: "development", WORKER_QUEUE_SCHEMA: "pgboss" });
    expect(readWorkerEnv({ DATABASE_URL, NODE_ENV: "test", WORKER_QUEUE_SCHEMA: "isolated_queue" }).WORKER_QUEUE_SCHEMA).toBe("isolated_queue");
    expect(parseDatabaseUrl(` ${DATABASE_URL} `)).toBe(DATABASE_URL);
  });
  it.each([undefined, "", "not-a-url-do-not-log", "https://user:do-not-log@localhost/lifeos", "postgresql://localhost/"])("rejects missing or malformed database URL %#", (DATABASE_URL) => {
    for (const read of [readDatabaseEnv, readWebEnv, readWorkerEnv]) {
      expect(() => read({ DATABASE_URL })).toThrow(EnvironmentConfigurationError);
      try { read({ DATABASE_URL }); } catch (error) {
        expect(String(error)).toContain("DATABASE_URL");
        expect(String(error)).not.toContain("do-not-log");
        expect(error).not.toHaveProperty("cause");
      }
    }
  });
  it("reports all invalid settings without retaining their inputs", () => {
    try {
      readWorkerEnv({ DATABASE_URL: "private-url", NODE_ENV: "private-env", WORKER_QUEUE_SCHEMA: "private-schema!" });
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentConfigurationError);
      expect(error).toMatchObject({ settings: ["DATABASE_URL", "NODE_ENV", "WORKER_QUEUE_SCHEMA"] });
      expect(String(error)).not.toContain("private");
      expect(JSON.stringify(error)).not.toContain("private");
    }
  });
  it.each(["", "public", "drizzle", "information_schema", "pg_catalog", "MixedCase", "bad;schema", "queue\n", "a".repeat(51)])("rejects unsafe queue namespace %#", (WORKER_QUEUE_SCHEMA) => {
    expect(() => readWorkerEnv({ DATABASE_URL, WORKER_QUEUE_SCHEMA })).toThrow("WORKER_QUEUE_SCHEMA must be");
  });
  it("rejects an unknown NODE_ENV in both process configurations", () => {
    expect(() => readWebEnv({ DATABASE_URL, NODE_ENV: "staging" })).toThrow("NODE_ENV");
    expect(() => readWorkerEnv({ DATABASE_URL, NODE_ENV: "staging" })).toThrow("NODE_ENV");
  });
});
