import { getAuth } from "../../../../server/auth/index.ts";
import { getDashboardReader } from "../../../../server/core.ts";
import { createDashboardRoutes } from "../../../../server/dashboard.ts";

export const dynamic = "force-dynamic";
const routes = createDashboardRoutes({ resolveAuth: getAuth, resolveReader: getDashboardReader });
export const GET = routes.GET;
