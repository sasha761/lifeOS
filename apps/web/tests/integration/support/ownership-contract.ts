import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { apiFailureSchema } from "@lifeos/contracts";
import { NotFoundError } from "@lifeos/domain";
import type { Actor } from "@lifeos/domain";
import type { TestUser } from "./auth-harness.ts";

/**
 * Reusable two-user negative checks for owned resources (LFS-202, ADR-006).
 *
 * A suite for a new owned resource (goals, goal measurements, activity events, …) creates two users
 * with createAuthHarness and calls:
 * - expectDomainOwnership with its service commands → the other user gets NotFoundError for read,
 *   update and delete, exactly as for an unknown id, and the owner's stored record is unchanged;
 * - expectHttpOwnership with its route handlers → guests get 401, the other user gets a 404 that is
 *   indistinguishable from an unknown id and carries none of the owner's data.
 * Owner success paths stay in the resource's own tests.
 */
export type OwnedResourceCommands = {
  /** Creates a resource owned by `actor` and returns its id. */
  create(actor: Actor): Promise<string>;
  read(actor: Actor, id: string): Promise<unknown>;
  update(actor: Actor, id: string): Promise<unknown>;
  remove(actor: Actor, id: string): Promise<unknown>;
  /** Stored state read without ownership filters, to prove a foreign attempt changed nothing. */
  snapshot(id: string): Promise<unknown>;
};

export type UserPair = { owner: TestUser; other: TestUser };

/** Returns the id of the owner's resource it created, for further checks by the caller. */
export async function expectDomainOwnership(commands: OwnedResourceCommands, { owner, other }: UserPair): Promise<string> {
  const id = await commands.create(owner.actor);
  const unknownId = randomUUID();
  const before = await commands.snapshot(id);
  expect(before).toBeTruthy();
  const attempts = {
    read: (actor: Actor, target: string) => commands.read(actor, target),
    update: (actor: Actor, target: string) => commands.update(actor, target),
    remove: (actor: Actor, target: string) => commands.remove(actor, target),
  };
  for (const [name, attempt] of Object.entries(attempts)) {
    await expect(attempt(other.actor, id), `${name} of a foreign resource`).rejects.toBeInstanceOf(NotFoundError);
    await expect(attempt(other.actor, unknownId), `${name} of an unknown id`).rejects.toBeInstanceOf(NotFoundError);
  }
  expect(await commands.snapshot(id)).toEqual(before);
  await expect(commands.read(owner.actor, id)).resolves.toBeTruthy();
  return id;
}

export type OwnedRouteRequest = {
  name: string;
  /** Sends the request for resource `id`, with the given session cookie or none. */
  send(id: string, cookie?: string): Promise<Response>;
};

const errorCodes = (text: string) => apiFailureSchema.parse(JSON.parse(text)).errors.map((error) => error.code);

export async function expectHttpOwnership(options: {
  requests: readonly OwnedRouteRequest[];
  users: UserPair;
  ownedId: string;
  /** Values only the owner may see (titles, numbers, notes); none may appear in a foreign response. */
  ownerSecrets: readonly string[];
  /** Stored state without ownership filters; must be equal before and after all attempts. */
  snapshot(): Promise<unknown>;
}): Promise<void> {
  const { owner, other } = options.users;
  const before = await options.snapshot();
  for (const request of options.requests) {
    const anonymous = await request.send(options.ownedId);
    const anonymousText = await anonymous.text();
    expect(anonymous.status, `${request.name} without a session`).toBe(401);
    expect(errorCodes(anonymousText)).toEqual(["UNAUTHORIZED"]);

    const foreign = await request.send(options.ownedId, other.cookie);
    const foreignText = await foreign.text();
    const unknown = await request.send(randomUUID(), other.cookie);
    const unknownText = await unknown.text();
    expect(foreign.status, `${request.name} of a foreign resource`).toBe(404);
    expect(unknown.status, `${request.name} of an unknown id`).toBe(404);
    expect(errorCodes(foreignText)).toEqual(["NOT_FOUND"]);
    // Foreign and unknown ids must be indistinguishable: never 403, never a different message.
    expect(errorCodes(foreignText)).toEqual(errorCodes(unknownText));
    for (const text of [anonymousText, foreignText]) {
      for (const secret of [...options.ownerSecrets, owner.userId, owner.email]) expect(text).not.toContain(secret);
    }
  }
  expect(await options.snapshot()).toEqual(before);
}
