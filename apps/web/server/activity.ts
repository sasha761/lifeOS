import { activityFeedSchema } from "@lifeos/contracts";
import type { ActivityReader } from "@lifeos/domain";
import { apiRoute } from "./api-route.ts";
import type { HttpLogger } from "./api-route.ts";
import type { Auth } from "./auth/create-auth.ts";
import { requireApiActor } from "./auth/session.ts";
import { query } from "./goals.ts";

export type ActivityRouteDependencies = { resolveAuth(): Auth; resolveReader(): ActivityReader; log?: HttpLogger };

/**
 * GET /api/v1/activity (LFS-213): the verified actor's own journal, optionally `domain_key` or `goal_id`, `limit`.
 * The session is checked before the query is read; the domain rejects unknown keys such as `user_id`.
 */
export function createActivityRoutes({ resolveAuth, resolveReader, log }: ActivityRouteDependencies) {
  return {
    GET: apiRoute(activityFeedSchema, async (request) => {
      const actor = await requireApiActor(resolveAuth(), request.headers);
      return resolveReader().list(actor, query(request));
    }, log),
  };
}
