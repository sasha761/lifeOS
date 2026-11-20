import { getAuth } from "../../../../server/auth/index.ts";
import { getStarterPackService } from "../../../../server/core.ts";
import { createStarterPackRoutes } from "../../../../server/starter-pack.ts";

export const dynamic = "force-dynamic";
const routes = createStarterPackRoutes({ resolveAuth: getAuth, resolveStarterPack: getStarterPackService });
export const POST = routes.POST;
export const DELETE = routes.DELETE;
