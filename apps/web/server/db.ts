import "server-only";
import { createDatabase } from "@lifeos/db";
import type { DatabaseClient } from "@lifeos/db";

// One pool per Web process; cached on globalThis so dev module reloads do not leak connections.
const store = globalThis as typeof globalThis & { lifeosWebDatabase?: DatabaseClient };

export function getDatabase(connectionString: string): DatabaseClient {
  store.lifeosWebDatabase ??= createDatabase({
    connectionString,
    // Idle client errors carry server details; record only that one happened.
    onIdleError: () => console.error(JSON.stringify({ event: "db.pool_error" })),
  });
  return store.lifeosWebDatabase;
}
