import { createDatabase, applyMigrations, readTestDatabaseUrl, databaseErrorMessage } from "../src/index.ts";

async function main(): Promise<void> {
  // Never fall back to DATABASE_URL; validate the dedicated test target before constructing a pool.
  const client = createDatabase({ connectionString: readTestDatabaseUrl(process.env) });
  try {
    await applyMigrations(client.db);
    console.log("Test database migrations applied successfully.");
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(databaseErrorMessage(error));
  process.exitCode = 1;
});
