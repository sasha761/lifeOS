import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { createDatabase, databaseErrorMessage, readTestDatabaseUrl } from "../../src/index.ts";

// One journal row per generated migration; re-running the CLI must not add rows.
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: unknown[] };

it("runs the test migration CLI twice against PostgreSQL with one journal entry per migration", async () => {
  const connectionString = readTestDatabaseUrl(process.env);
  for (let run = 0; run < 2; run++) {
    const result = spawnSync(process.execPath, ["scripts/migrate-test.ts"], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: { ...process.env, TEST_DATABASE_URL: connectionString }, encoding: "utf8", timeout: 10_000, windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Test database migrations applied successfully.");
    expect(result.stderr).toBe("");
  }
  const client = createDatabase({ connectionString });
  try {
    const result = await client.pool.query<{ fixture: string | null; users: string | null; migrations: number }>(
      "SELECT to_regclass('public.foundation_migration_fixture')::text AS fixture, to_regclass('public.\"user\"')::text AS users, (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS migrations",
    ).catch((error: unknown) => { throw new Error(databaseErrorMessage(error)); });
    expect(journal.entries.length).toBeGreaterThanOrEqual(2);
    expect(result.rows[0]).toEqual({ fixture: "foundation_migration_fixture", users: "\"user\"", migrations: journal.entries.length });
  } finally { await client.close(); }
});
