import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { parseDatabaseUrl } from "./configuration.ts";
import * as schema from "./schema/index.ts";

export type LifeosDatabase = NodePgDatabase<typeof schema>;

export type DatabaseOptions = {
  connectionString: string;
  onIdleError?: () => void;
};

export type DatabaseClient = {
  db: LifeosDatabase;
  pool: Pool;
  close: () => Promise<void>;
};

export function createDatabase(options: DatabaseOptions): DatabaseClient {
  const pool = new Pool({
    connectionString: parseDatabaseUrl(options.connectionString),
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: "lifeos",
  });
  pool.on("error", () => options.onIdleError?.());
  const db: LifeosDatabase = drizzle({ client: pool, schema });
  return { db, pool, close: () => pool.end() };
}
