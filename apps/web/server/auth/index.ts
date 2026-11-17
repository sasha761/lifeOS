import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readWebEnv } from "@lifeos/config/env";
import type { CurrentUser } from "@lifeos/contracts";
import { createSignupPolicy } from "@lifeos/domain";
import { safeRedirectPath } from "../../lib/safe-redirect.ts";
import { getDatabase } from "../db.ts";
import { createMailSender } from "../mail/index.ts";
import { createAuth } from "./create-auth.ts";
import type { Auth } from "./create-auth.ts";
import { findVerifiedSession } from "./session.ts";
import type { VerifiedSession } from "./session.ts";

const store = globalThis as typeof globalThis & { lifeosAuth?: Auth };

/** Lazily composed at request time, never during `next build`; env is validated on first use. */
export function getAuth(): Auth {
  if (!store.lifeosAuth) {
    const env = readWebEnv(process.env);
    store.lifeosAuth = createAuth({
      database: getDatabase(env.DATABASE_URL).db,
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      signupPolicy: createSignupPolicy(env.AUTH_SIGNUP_ALLOWLIST),
      mail: createMailSender(env.mail),
    });
  }
  return store.lifeosAuth;
}

export async function getPageSession(): Promise<VerifiedSession | null> {
  // Read request headers first: this marks the page dynamic, so `next build` never touches env or DB here.
  const requestHeaders = await headers();
  return findVerifiedSession(getAuth(), requestHeaders);
}

export async function getPageUser(): Promise<CurrentUser | null> {
  return (await getPageSession())?.user ?? null;
}

/**
 * Server-side guard for pages. Hiding links is not protection: every protected page calls this
 * (or requirePageUser) and passes the returned Actor to domain services.
 */
export async function requirePageSession(returnTo: string): Promise<VerifiedSession> {
  const session = await getPageSession();
  if (!session) redirect(`/auth/sign-in?next=${encodeURIComponent(safeRedirectPath(returnTo))}`);
  return session;
}

export async function requirePageUser(returnTo: string): Promise<CurrentUser> {
  return (await requirePageSession(returnTo)).user;
}
