import { createAuthClient } from "better-auth/client";

// Browser client for /api/auth/* (same origin). Forms call Better Auth over HTTP so its CSRF/origin
// checks and production rate limits apply; server code uses getAuth() instead.
export const authClient = createAuthClient({ basePath: "/api/auth" });
