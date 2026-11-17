import { currentUserSchema } from "@lifeos/contracts";
import type { CurrentUser } from "@lifeos/contracts";
import { actorFromVerifiedSession } from "@lifeos/domain";
import type { Actor } from "@lifeos/domain";
import { ApiError } from "../api-error.ts";
import { apiRoute } from "../api-route.ts";
import type { Auth } from "./create-auth.ts";

/** A session the server has verified: the identity for display and the Actor for domain commands. */
export type VerifiedSession = { user: CurrentUser; actor: Actor };

/**
 * The only way to obtain the acting user: a server-verified session cookie looked up in PostgreSQL.
 * Request bodies, query strings and custom headers never identify the actor (LFS-201, LFS-202).
 */
export async function findVerifiedSession(auth: Auth, headers: Headers): Promise<VerifiedSession | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const user = currentUserSchema.parse({ id: session.user.id, email: session.user.email, name: session.user.name });
  return { user, actor: actorFromVerifiedSession(user.id) };
}

export async function findCurrentUser(auth: Auth, headers: Headers): Promise<CurrentUser | null> {
  return (await findVerifiedSession(auth, headers))?.user ?? null;
}

/** Route Handler guard: 401 UNAUTHORIZED in the common envelope without a valid session. */
export async function requireApiSession(auth: Auth, headers: Headers): Promise<VerifiedSession> {
  const session = await findVerifiedSession(auth, headers);
  if (!session) throw new ApiError("UNAUTHORIZED");
  return session;
}

export async function requireApiUser(auth: Auth, headers: Headers): Promise<CurrentUser> {
  return (await requireApiSession(auth, headers)).user;
}

/** Route Handler entry point for domain commands: the Actor of the verified session, never a request value. */
export async function requireApiActor(auth: Auth, headers: Headers): Promise<Actor> {
  return (await requireApiSession(auth, headers)).actor;
}

/** GET /api/v1/me: the current identity in the common envelope, 401 without a valid session. */
export function createCurrentUserRoute(resolveAuth: () => Auth) {
  return apiRoute(currentUserSchema, (request) => requireApiUser(resolveAuth(), request.headers));
}
