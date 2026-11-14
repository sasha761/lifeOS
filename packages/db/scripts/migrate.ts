import { createDatabase, applyMigrations, parseDatabaseUrl, databaseErrorMessage } from "../src/index.ts";

async function main(): Promise<void> {
  const client = createDatabase({ connectionString: parseDatabaseUrl(process.env.DATABASE_URL) });
  try {
    await applyMigrations(client.db);
    console.log("Database migrations applied successfully.");
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(databaseErrorMessage(error));
  process.exitCode = 1;
});
