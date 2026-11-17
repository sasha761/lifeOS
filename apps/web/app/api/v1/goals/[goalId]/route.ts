import { getAuth } from "../../../../../server/auth/index.ts";
import { getGoalsService, getGoalMeasurementsService, getGoalsReader } from "../../../../../server/core.ts";
import { createGoalsRoutes } from "../../../../../server/goals.ts";

export const dynamic = "force-dynamic";
const routes = createGoalsRoutes({ resolveAuth: getAuth, resolveGoals: getGoalsService, resolveMeasurements: getGoalMeasurementsService, resolveReader: getGoalsReader });
export const GET = routes.goal.GET;
export const PATCH = routes.goal.PATCH;
