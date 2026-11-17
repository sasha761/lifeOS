import type { Actor } from "./actor.ts";
import { NotFoundError } from "./errors.ts";

/** A personal record with an explicit owner column (`user_id`). */
export type Owned = { readonly userId: string };

/**
 * Ownership rule for core resources (LFS-202, ADR-006).
 *
 * 1. Repositories filter every select/update/delete by `user_id = actor.userId` in SQL
 *    (`ownedBy` in @lifeos/db), so another user's row is never loaded or changed.
 * 2. Services pass the result through `requireOwned`: a missing row and a foreign row both become
 *    NotFoundError (HTTP 404), and a row that slipped past a faulty filter is still refused.
 */
export function requireOwned<T extends Owned>(actor: Actor, resource: T | null | undefined): T {
  if (!resource || resource.userId !== actor.userId) throw new NotFoundError();
  return resource;
}

/** For records addressed by the actor alone (the actor's own profile): absence is a NotFoundError too. */
export function requireFound<T>(resource: T | null | undefined): T {
  if (resource === null || resource === undefined) throw new NotFoundError();
  return resource;
}
