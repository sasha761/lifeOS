import { getAuth } from "../../../../../server/auth/index.ts";
import { getOnboardingService } from "../../../../../server/core.ts";
import { createOnboardingRoutes } from "../../../../../server/onboarding.ts";

export const dynamic = "force-dynamic";
export const POST = createOnboardingRoutes({ resolveAuth: getAuth, resolveOnboarding: getOnboardingService }).complete.POST;
