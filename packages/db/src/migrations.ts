import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { LifeosDatabase } from "./client.ts";

export async function applyMigrations(database: LifeosDatabase, options: { migrationsSchema?: string } = {}): Promise<void> {
  await migrate(database, {
    migrationsFolder: fileURLToPath(new URL("../drizzle/", import.meta.url)),
    migrationsSchema: options.migrationsSchema ?? "drizzle",
  });
}
