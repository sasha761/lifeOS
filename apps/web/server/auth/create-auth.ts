import { defineRequestState } from "@better-auth/core/context";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { EMAIL_DELIVERY_FAILED, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, SIGNUP_NOT_ALLOWED } from "@lifeos/contracts";
import { schema } from "@lifeos/db";
import type { LifeosDatabase } from "@lifeos/db";
import type { SignupPolicy } from "@lifeos/domain";
import { AUTH_COOKIE_PREFIX } from "../../lib/auth-cookie.ts";
import { passwordResetMessage } from "../mail/messages.ts";
import type { MailSender } from "../mail/types.ts";

export { AUTH_COOKIE_PREFIX };
export const AUTH_BASE_PATH = "/api/auth";
export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
export const RESET_TOKEN_EXPIRES_IN_SECONDS = 60 * 60;

// Better Auth 1.7.18 awaits sendResetPassword but catches and only logs its errors, so the endpoint
// would still answer "check your email". This request-scoped flag lets an after-hook turn a failed
// delivery into a 503 instead (Better Auth runs each endpoint and its hooks in one request state).
const resetDeliveryFailed = defineRequestState(() => false);

export type AuthDependencies = {
  database: LifeosDatabase;
  secret: string;
  /** Public origin of the Web app, e.g. https://lifeos.example.com. */
  baseURL: string;
  signupPolicy: SignupPolicy;
  mail: MailSender;
  /** Better Auth rate limiting; defaults to its own rule (enabled only in production). */
  rateLimit?: boolean;
};

/**
 * Better Auth 1.7.18 for email/password (LFS-201). Framework-independent composition: Next.js
 * adapters live in route handlers, so tests can build the same instance with an isolated database.
 */
export function createAuth(dependencies: AuthDependencies) {
  const { database, secret, baseURL, signupPolicy, mail } = dependencies;
  return betterAuth({
    appName: "LifeOS",
    baseURL,
    basePath: AUTH_BASE_PATH,
    secret,
    database: drizzleAdapter(database, {
      provider: "pg",
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
      // Sign-up (user + credential account) and password reset (+ session revocation) commit atomically.
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      autoSignIn: true,
      resetPasswordTokenExpiresIn: RESET_TOKEN_EXPIRES_IN_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        try {
          await mail.send(passwordResetMessage({ to: user.email, url, expiresInMinutes: RESET_TOKEN_EXPIRES_IN_SECONDS / 60 }));
        } catch {
          // No address, link or transport details in logs; the unsent token is hashed and expires.
          console.error(JSON.stringify({ event: "mail.delivery_failed", purpose: "password_reset", transport: mail.transport }));
          await resetDeliveryFailed.set(true);
        }
      },
    },
    hooks: {
      after: createAuthMiddleware(async (context) => {
        if (context.path === "/request-password-reset" && await resetDeliveryFailed.get()) {
          throw new APIError("SERVICE_UNAVAILABLE", { code: EMAIL_DELIVERY_FAILED, message: "The email could not be sent." });
        }
      }),
    },
    user: {
      // Server-side registration rule (open or allowlist). Runs for every user creation path; sign-in is not affected.
      validateUserInfo: ({ user, source }) => {
        if (source.action !== "create-user") return;
        if (typeof user.email === "string" && signupPolicy.isAllowed(user.email)) return;
        return { error: SIGNUP_NOT_ALLOWED, errorDescription: "Registration is closed for this email." };
      },
    },
    // Reset tokens are stored as SHA-256 hashes; the database never holds a usable token.
    verification: { storeIdentifier: "hashed" },
    // Absolute 7-day sessions. Server Components cannot rewrite cookies, so a DB-only refresh would
    // drift from the cookie lifetime; a sliding session is a later, explicit decision.
    session: { expiresIn: SESSION_EXPIRES_IN_SECONDS, disableSessionRefresh: true },
    rateLimit: dependencies.rateLimit === undefined ? undefined : { enabled: dependencies.rateLimit },
    advanced: { cookiePrefix: AUTH_COOKIE_PREFIX },
    telemetry: { enabled: false },
    logger: { level: "warn" },
  });
}

export type Auth = ReturnType<typeof createAuth>;
