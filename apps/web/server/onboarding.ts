import { onboardingCompletedSchema, onboardingStateSchema } from "@lifeos/contracts";
import type { OnboardingService } from "@lifeos/domain";
import { apiRoute } from "./api-route.ts";
import type { HttpLogger } from "./api-route.ts";
import type { Auth } from "./auth/create-auth.ts";
import { requireApiActor } from "./auth/session.ts";
import { commandContext, json, noQuery, requireSameOrigin } from "./goals.ts";

export type OnboardingRouteDependencies = { resolveAuth(): Auth; resolveOnboarding(): OnboardingService; log?: HttpLogger };

/**
 * /api/v1/onboarding (LFS-219). The resource is always the session actor's own: no user id in the URL or body. The
 * session guard runs first. PUT replaces the draft as a whole, so it needs no Idempotency-Key; «Создать N целей» does.
 */
export function createOnboardingRoutes({ resolveAuth, resolveOnboarding, log }: OnboardingRouteDependencies) {
  return {
    state: {
      GET: apiRoute(onboardingStateSchema, async (request) => {
        const actor = await requireApiActor(resolveAuth(), request.headers);
        noQuery(request);
        return resolveOnboarding().get(actor);
      }, log),
      PUT: apiRoute(onboardingStateSchema, async (request) => {
        const actor = await requireApiActor(resolveAuth(), request.headers);
        requireSameOrigin(request, resolveAuth().options.baseURL);
        noQuery(request);
        return resolveOnboarding().saveDraft(actor, await json(request));
      }, log),
      // LFS-220: a start choice of the popup (the rhythm from Settings was removed by LFS-222). Repeating it gives the
      // same state, so no Idempotency-Key; a completed setup refuses a start choice with 409.
      PATCH: apiRoute(onboardingStateSchema, async (request) => {
        const actor = await requireApiActor(resolveAuth(), request.headers);
        requireSameOrigin(request, resolveAuth().options.baseURL);
        noQuery(request);
        return resolveOnboarding().update(actor, await json(request));
      }, log),
    },
    complete: {
      POST: apiRoute(onboardingCompletedSchema, async (request) => {
        const actor = await requireApiActor(resolveAuth(), request.headers);
        const options = commandContext(request, resolveAuth().options.baseURL);
        return resolveOnboarding().complete(actor, await json(request), options);
      }, log),
    },
  };
}
