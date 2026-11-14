import { createDatabase, parseDatabaseUrl, databaseErrorMessage } from "../src/index.ts";

async function main(): Promise<void> {
  const client = createDatabase({ connectionString: parseDatabaseUrl(process.env.DATABASE_URL) });
  try {
    const result = await client.pool.query<{ fixture: string | null; history: string | null }>(
      "SELECT to_regclass('public.foundation_migration_fixture')::text AS fixture, to_regclass('drizzle.__drizzle_migrations')::text AS history",
    );
    const status = result.rows[0];
    console.log(`Database connection OK. Fixture: ${status?.fixture ? "present" : "absent"}. Migration history: ${status?.history ? "present" : "absent"}.`);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(databaseErrorMessage(error));
  process.exitCode = 1;
});
