import { getAuth } from "../../../../server/auth/index.ts";
import { getOnboardingService } from "../../../../server/core.ts";
import { createOnboardingRoutes } from "../../../../server/onboarding.ts";

export const dynamic = "force-dynamic";
const routes = createOnboardingRoutes({ resolveAuth: getAuth, resolveOnboarding: getOnboardingService });
export const GET = routes.state.GET;
export const PUT = routes.state.PUT;
