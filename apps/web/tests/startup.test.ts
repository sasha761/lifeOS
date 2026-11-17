import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const outboxEnvironment = {
  ...process.env,
  DATABASE_URL: "postgresql://startup@127.0.0.1:1/lifeos_startup",
  BETTER_AUTH_SECRET: "startup-test-secret-with-at-least-32-characters",
  BETTER_AUTH_URL: "http://127.0.0.1:3000",
  AUTH_SIGNUP_ALLOWLIST: "",
  MAIL_TRANSPORT: "outbox",
  MAIL_FROM: "startup@lifeos.invalid",
  MAIL_OUTBOX_DIR: ".cache/startup-mail",
  SMTP_URL: "smtp://127.0.0.1:1",
};

describe("Web process startup", () => {
  it.each(["dev", "start"])("rejects invalid env before loading Next CLI (%s)", (command) => {
    const result = spawnSync(process.execPath, ["scripts/run-next.ts", command], {
      cwd, env: { ...process.env, NODE_ENV: "production", DATABASE_URL: "https://private:do-not-log@localhost/lifeos" },
      encoding: "utf8", timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL must be a PostgreSQL URL");
    expect(result.stdout + result.stderr).not.toMatch(/Ready|do-not-log|stack|private/);
  });
  it("rejects missing credentials before normal operation", () => {
    const environment = { ...process.env };
    // An empty value must not fall back to a developer's root .env credentials.
    environment.DATABASE_URL = "";
    const result = spawnSync(process.execPath, ["scripts/run-next.ts", "start"], {
      cwd, env: environment, encoding: "utf8", timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL");
    expect(result.stdout).not.toContain("Ready");
  });

  it("rejects outbox for start before Next can listen when NODE_ENV is unset", () => {
    const environment: NodeJS.ProcessEnv = { ...outboxEnvironment };
    Reflect.deleteProperty(environment, "NODE_ENV");
    const result = spawnSync(process.execPath, ["scripts/run-next.ts", "start", "--help"], {
      cwd, env: environment, encoding: "utf8", timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("MAIL_TRANSPORT");
    expect(result.stdout).not.toMatch(/Usage|Ready/);
  });

  it.each([
    { command: "dev", transport: "outbox" },
    { command: "start", transport: "smtp" },
  ])("loads Next CLI with valid $command mail settings", ({ command, transport }) => {
    const environment: NodeJS.ProcessEnv = { ...outboxEnvironment, MAIL_TRANSPORT: transport };
    Reflect.deleteProperty(environment, "NODE_ENV");
    const result = spawnSync(process.execPath, ["scripts/run-next.ts", command, "--help"], {
      cwd, env: environment, encoding: "utf8", timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Usage: next ${command}`);
    expect(result.stderr).toBe("");
  });
});
