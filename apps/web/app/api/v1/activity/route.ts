import { getAuth } from "../../../../server/auth/index.ts";
import { createActivityRoutes } from "../../../../server/activity.ts";
import { getActivityReader } from "../../../../server/core.ts";

export const dynamic = "force-dynamic";
const routes = createActivityRoutes({ resolveAuth: getAuth, resolveReader: getActivityReader });
export const GET = routes.GET;
