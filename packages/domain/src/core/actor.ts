declare const verifiedActor: unique symbol;

/**
 * The user on whose behalf a domain command runs (LFS-202).
 *
 * Only server code that has verified a session creates an Actor, through
 * `actorFromVerifiedSession`. Request bodies, query strings and headers never do. The brand makes
 * `{ userId: body.userId }` a type error wherever a command or repository expects an Actor.
 */
export type Actor = { readonly userId: string; readonly [verifiedActor]: true };

export const ACTOR_USER_ID_MAX_LENGTH = 128;

/** Call only with the user id of a session the server has just verified (e.g. Better Auth getSession). */
export function actorFromVerifiedSession(userId: string): Actor {
  if (typeof userId !== "string" || userId.length === 0 || userId.length > ACTOR_USER_ID_MAX_LENGTH) {
    throw new Error("A verified actor requires the user id of a verified session.");
  }
  return Object.freeze({ userId }) as Actor;
}
