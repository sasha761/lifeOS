import { and, eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Actor } from "@lifeos/domain";

/**
 * SQL ownership filter for core repositories (LFS-202, ADR-006): `owner = actor.userId AND …`.
 *
 * Every select/update/delete of a personal record uses it, so another user's row is simply not
 * found and the service answers NOT_FOUND. `actor` is the branded, session-derived Actor from
 * @lifeos/domain; a raw id from a request cannot be passed here without a deliberate cast.
 */
export function ownedBy(ownerColumn: PgColumn, actor: Actor, ...conditions: SQL[]): SQL {
  const filter = and(eq(ownerColumn, actor.userId), ...conditions);
  if (!filter) throw new Error("The ownership filter could not be built.");
  return filter;
}
