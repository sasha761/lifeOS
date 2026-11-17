import { getAuth } from "../../../../../server/auth/index.ts";
import { getUserPreferencesService } from "../../../../../server/core.ts";
import { createUserPreferencesRoutes } from "../../../../../server/preferences.ts";

export const dynamic = "force-dynamic";

const routes = createUserPreferencesRoutes({ resolveAuth: getAuth, resolvePreferences: getUserPreferencesService });

export const GET = routes.GET;
export const PATCH = routes.PATCH;
