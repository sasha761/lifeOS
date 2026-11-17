import { getAuth } from "../../../../server/auth/index.ts";
import { createCurrentUserRoute } from "../../../../server/auth/session.ts";

export const dynamic = "force-dynamic";

export const GET = createCurrentUserRoute(getAuth);
