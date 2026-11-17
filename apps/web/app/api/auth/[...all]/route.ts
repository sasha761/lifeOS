import { getAuth } from "../../../../server/auth/index.ts";

// Better Auth endpoints (sign-up/sign-in/sign-out/session/password reset) under /api/auth/*.
// Responses use Better Auth's own JSON format, not the /api/v1 envelope.
export const dynamic = "force-dynamic";

const handle = (request: Request): Promise<Response> => getAuth().handler(request);
export const GET = handle;
export const POST = handle;
