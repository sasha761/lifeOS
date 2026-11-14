import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyMigrations, createDatabase, databaseErrorMessage, readTestDatabaseUrl, schema } from "../../src/index.ts";
import type { DatabaseClient } from "../../src/index.ts";

const schemaName = `lfs104_migration_${randomUUID().replaceAll("-", "")}`;
if (!/^lfs104_migration_[a-f0-9]{32}$/.test(schemaName)) throw new Error("Invalid isolated test schema name.");
const identifier = `"${schemaName}"`;
let administration: DatabaseClient | undefined;
let client: DatabaseClient | undefined;
let createdByThisRun = false;

async function databaseOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(databaseErrorMessage(error));
  }
}

beforeAll(async () => {
  await databaseOperation(async () => {
    const connectionString = readTestDatabaseUrl(process.env);
    administration = createDatabase({ connectionString });
    // No IF NOT EXISTS: a pre-existing namespace is never claimed or cleaned up.
    await administration.pool.query(`CREATE SCHEMA ${identifier}`);
    createdByThisRun = true;
    const isolated = new URL(connectionString);
    isolated.searchParams.set("options", `-csearch_path=${schemaName}`);
    client = createDatabase({ connectionString: isolated.toString() });
  });
});

afterAll(async () => {
  await databaseOperation(async () => {
    await client?.close();
    try {
      if (administration && createdByThisRun) {
        // Only this run's two known tables. RESTRICT preserves unexpected dependencies.
        await administration.pool.query(`DROP TABLE IF EXISTS ${identifier}.foundation_migration_fixture, ${identifier}.__drizzle_migrations`);
        await administration.pool.query(`DROP SCHEMA ${identifier}`);
      }
    } finally {
      await administration?.close();
    }
  });
});

it("applies migrations in a clean isolated schema and safely re-applies them", async () => {
  if (!client) throw new Error("The isolated database client was not initialized.");
  const connection = client;
  const result = await databaseOperation(async () => {
    const before = await connection.pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = $1", [schemaName],
    );
    await applyMigrations(connection.db, { migrationsSchema: schemaName });
    await connection.db.insert(schema.foundationMigrationFixture).values({ label: "lfs104-migration-smoke" });
    const first = await connection.pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${identifier}.__drizzle_migrations`);
    await applyMigrations(connection.db, { migrationsSchema: schemaName });
    const second = await connection.pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${identifier}.__drizzle_migrations`);
    const tables = await connection.pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name", [schemaName],
    );
    const rows = await connection.db.select().from(schema.foundationMigrationFixture);
    return { before: before.rows[0]?.count, first: first.rows[0]?.count, second: second.rows[0]?.count, tables: tables.rows, rows };
  });

  expect(result.before).toBe(0);
  expect(result.first).toBe(1);
  expect(result.second).toBe(1);
  expect(result.tables.map((table) => table.table_name)).toEqual(["__drizzle_migrations", "foundation_migration_fixture"]);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]?.label).toBe("lfs104-migration-smoke");
});
