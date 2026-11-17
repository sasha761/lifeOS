import { dashboardSchema } from "@lifeos/contracts";
import type { DashboardReader } from "@lifeos/domain";
import { ApiError } from "./api-error.ts";
import { apiRoute } from "./api-route.ts";
import type { HttpLogger } from "./api-route.ts";
import type { Auth } from "./auth/create-auth.ts";
import { requireApiActor } from "./auth/session.ts";

export type DashboardRouteDependencies = { resolveAuth(): Auth; resolveReader(): DashboardReader; log?: HttpLogger };

/** GET /api/v1/dashboard: the verified actor's own read model; no parameters, so nothing can select another owner. */
export function createDashboardRoutes({ resolveAuth, resolveReader, log }: DashboardRouteDependencies) {
  return {
    GET: apiRoute(dashboardSchema, async (request) => {
      const actor = await requireApiActor(resolveAuth(), request.headers);
      // Any query (including a forged user_id) is rejected, never interpreted.
      if (new URL(request.url).search !== "") throw new ApiError("VALIDATION_ERROR");
      return resolveReader().get(actor);
    }, log),
  };
}
