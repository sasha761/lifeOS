import { starterPackAppliedSchema, starterPackRemovedSchema } from "@lifeos/contracts";
import type { StarterPackService } from "@lifeos/domain";
import { apiRoute } from "./api-route.ts";
import type { HttpLogger } from "./api-route.ts";
import type { Auth } from "./auth/create-auth.ts";
import { requireApiActor } from "./auth/session.ts";
import { commandContext, requireEmptyBody } from "./goals.ts";

export type StarterPackRouteDependencies = { resolveAuth(): Auth; resolveStarterPack(): StarterPackService; log?: HttpLogger };

/**
 * /api/v1/starter-pack (LFS-218): POST loads the example the person chose, DELETE is «Удалить все примеры». Both take no
 * body; the session guard runs before anything else, then Origin, query and Idempotency-Key as for every goal write.
 */
export function createStarterPackRoutes({ resolveAuth, resolveStarterPack, log }: StarterPackRouteDependencies) {
  return {
    POST: apiRoute(starterPackAppliedSchema, async (request) => {
      const actor = await requireApiActor(resolveAuth(), request.headers);
      const options = commandContext(request, resolveAuth().options.baseURL);
      await requireEmptyBody(request);
      return resolveStarterPack().apply(actor, options);
    }, log),
    DELETE: apiRoute(starterPackRemovedSchema, async (request) => {
      const actor = await requireApiActor(resolveAuth(), request.headers);
      const options = commandContext(request, resolveAuth().options.baseURL);
      await requireEmptyBody(request);
      return resolveStarterPack().remove(actor, options);
    }, log),
  };
}
