import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cwd = fileURLToPath(new URL("../", import.meta.url));

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
    delete environment.DATABASE_URL;
    const result = spawnSync(process.execPath, ["scripts/run-next.ts", "start"], {
      cwd, env: environment, encoding: "utf8", timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL");
    expect(result.stdout).not.toContain("Ready");
  });
});
