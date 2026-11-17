import { z } from "zod";
import { userPreferencesSchema } from "@lifeos/contracts";
import type { UserPreferencesService } from "@lifeos/domain";
import { apiRoute, parseJsonBody } from "./api-route.ts";
import type { Auth } from "./auth/create-auth.ts";
import { requireApiActor } from "./auth/session.ts";

export type UserPreferencesRouteDependencies = {
  resolveAuth: () => Auth;
  resolvePreferences: () => UserPreferencesService;
};

/**
 * GET/PATCH /api/v1/me/preferences (LFS-202). The resource is always the session actor's own:
 * there is no user id in the URL, and the domain service validates the body (strict: `userId` → 400).
 * The session is checked before the body is read, so guests get 401 regardless of input.
 */
export function createUserPreferencesRoutes({ resolveAuth, resolvePreferences }: UserPreferencesRouteDependencies) {
  return {
    GET: apiRoute(userPreferencesSchema, async (request) => {
      const actor = await requireApiActor(resolveAuth(), request.headers);
      return resolvePreferences().get(actor);
    }),
    PATCH: apiRoute(userPreferencesSchema, async (request) => {
      const actor = await requireApiActor(resolveAuth(), request.headers);
      return resolvePreferences().update(actor, await parseJsonBody(request, z.unknown()));
    }),
  };
}
