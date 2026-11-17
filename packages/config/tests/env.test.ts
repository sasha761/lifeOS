import { describe, expect, it } from "vitest";
import { EnvironmentConfigurationError, parseDatabaseUrl, readDatabaseEnv, readWebEnv, readWorkerEnv } from "../src/env.ts";

const DATABASE_URL = "postgresql://fixture:do-not-log@127.0.0.1:15432/lifeos";
const BETTER_AUTH_SECRET = "fixture-auth-secret-do-not-log-0123456789";
const SMTP_URL = "smtps://mailer:do-not-log@smtp.example.com:465";
const web = {
  DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL: "http://127.0.0.1:3000",
  MAIL_TRANSPORT: "outbox", MAIL_FROM: "no-reply@lifeos.local", MAIL_OUTBOX_DIR: "../../.cache/dev-mail",
};

describe("explicit environment validation", () => {
  it("validates database, web and worker independently with safe defaults", () => {
    expect(readDatabaseEnv({ DATABASE_URL })).toEqual({ DATABASE_URL });
    expect(readWebEnv({ ...web, NODE_ENV: "production", MAIL_TRANSPORT: "smtp", SMTP_URL, WORKER_QUEUE_SCHEMA: "invalid!", SECRET: "private" }))
      .toEqual({
        DATABASE_URL, NODE_ENV: "production", BETTER_AUTH_SECRET, BETTER_AUTH_URL: "http://127.0.0.1:3000",
        AUTH_SIGNUP_ALLOWLIST: [], mail: { transport: "smtp", from: "no-reply@lifeos.local", url: SMTP_URL },
      });
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

describe("web auth and mail environment", () => {
  it("defaults to a closed registration and keeps allowlist entries without echoing them in errors", () => {
    expect(readWebEnv(web)).toMatchObject({
      NODE_ENV: "development", AUTH_SIGNUP_ALLOWLIST: [],
      mail: { transport: "outbox", from: "no-reply@lifeos.local", directory: "../../.cache/dev-mail" },
    });
    expect(readWebEnv({ ...web, AUTH_SIGNUP_ALLOWLIST: " Owner@Example.com , second@example.org,," }).AUTH_SIGNUP_ALLOWLIST)
      .toEqual(["Owner@Example.com", "second@example.org"]);
    expect(() => readWebEnv({ ...web, AUTH_SIGNUP_ALLOWLIST: "owner@example.com,do-not-log" })).toThrow("AUTH_SIGNUP_ALLOWLIST must be");
  });
  it("normalizes the auth base URL to an origin and rejects paths, queries and credentials", () => {
    expect(readWebEnv({ ...web, BETTER_AUTH_URL: " https://lifeos.example.com/ " }).BETTER_AUTH_URL).toBe("https://lifeos.example.com");
    for (const BETTER_AUTH_URL of ["ftp://example.com", "https://example.com/app", "https://example.com/?x=1", "https://user:do-not-log@example.com", "not a url"]) {
      expect(() => readWebEnv({ ...web, BETTER_AUTH_URL })).toThrow("BETTER_AUTH_URL must be");
    }
  });
  it.each([undefined, "short-do-not-log", "replace-me-replace-me-replace-me-123", `${"x".repeat(20)} ${"y".repeat(20)}`])("rejects a missing, short or placeholder auth secret %#", (BETTER_AUTH_SECRET) => {
    try {
      readWebEnv({ ...web, BETTER_AUTH_SECRET });
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toMatchObject({ settings: ["BETTER_AUTH_SECRET"] });
      expect(String(error)).not.toContain("do-not-log");
    }
  });
  it("requires an explicit transport, its destination and real delivery in production", () => {
    expect(() => readWebEnv({ ...web, MAIL_TRANSPORT: undefined })).toThrow("MAIL_TRANSPORT must be");
    expect(() => readWebEnv({ ...web, MAIL_OUTBOX_DIR: undefined })).toThrow("MAIL_OUTBOX_DIR is required");
    expect(() => readWebEnv({ ...web, MAIL_TRANSPORT: "smtp" })).toThrow("SMTP_URL must be");
    expect(() => readWebEnv({ ...web, MAIL_TRANSPORT: "smtp", SMTP_URL: "https://smtp.example.com" })).toThrow("SMTP_URL must be");
    expect(() => readWebEnv({ ...web, MAIL_FROM: "LifeOS" })).toThrow("MAIL_FROM must be");
    try {
      readWebEnv({ ...web, NODE_ENV: "production" });
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toMatchObject({ settings: ["MAIL_TRANSPORT"] });
    }
  });
  it("never includes SMTP credentials in validation errors", () => {
    try {
      readWebEnv({ ...web, MAIL_TRANSPORT: "smtp", SMTP_URL: "https://mailer:do-not-log@smtp.example.com" });
      throw new Error("Expected rejection");
    } catch (error) {
      expect(String(error)).not.toContain("do-not-log");
      expect(JSON.stringify(error)).not.toContain("do-not-log");
    }
  });
});
