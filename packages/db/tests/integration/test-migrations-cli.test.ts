import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { createDatabase, databaseErrorMessage, readTestDatabaseUrl } from "../../src/index.ts";

it("runs the test migration CLI twice against PostgreSQL with one migration journal entry", async () => {
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
    const result = await client.pool.query<{ fixture: string | null; migrations: number }>(
      "SELECT to_regclass('public.foundation_migration_fixture')::text AS fixture, (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS migrations",
    ).catch((error: unknown) => { throw new Error(databaseErrorMessage(error)); });
    expect(result.rows[0]).toEqual({ fixture: "foundation_migration_fixture", migrations: 1 });
  } finally { await client.close(); }
});
