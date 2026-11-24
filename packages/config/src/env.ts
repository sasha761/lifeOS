import { env as processEnvironment } from "node:process";
import { z } from "zod";

export type Environment = Readonly<Record<string, string | undefined>>;
export const postgresUrlSchema = z.string().trim().refine((value) => {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol) && !!url.hostname && url.pathname.length > 1;
  } catch { return false; }
}).transform((value) => new URL(value).toString());

const nodeEnvironmentSchema = z.enum(["development", "test", "production"]).default("development");
const queueSchema = z.string().min(1).max(50).regex(/^[a-z]/).refine((value) =>
  !/[^a-z0-9_]/.test(value) && !["public", "drizzle", "information_schema"].includes(value) && !value.startsWith("pg_"),
).default("pgboss");

// Public origin of the Web app (Better Auth baseURL): http(s), no credentials, path, query or fragment.
export const httpOriginSchema = z.string().trim().refine((value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password
      && url.pathname === "/" && !url.search && !url.hash;
  } catch { return false; }
}).transform((value) => new URL(value).origin);
const authSecretSchema = z.string().min(32).max(512).refine((value) => !/\s/.test(value) && !/replace-me|change-me/i.test(value));
// Who may create an account: open (default, LFS-221) or allowlist. The list is used only in allowlist mode;
// normalization and matching live in @lifeos/domain.
const signupModeSchema = z.enum(["open", "allowlist"]).default("open");
const signupAllowlistSchema = z.string().default("")
  .transform((value) => value.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0))
  .pipe(z.array(z.email()).max(100));
const smtpUrlSchema = z.string().trim().refine((value) => {
  try {
    const url = new URL(value);
    return ["smtp:", "smtps:"].includes(url.protocol) && !!url.hostname;
  } catch { return false; }
});

export type MailSettings =
  | { transport: "outbox"; from: string; directory: string }
  | { transport: "smtp"; from: string; url: string };

export const databaseEnvSchema = z.object({ DATABASE_URL: postgresUrlSchema });
export const webEnvSchema = databaseEnvSchema.extend({
  NODE_ENV: nodeEnvironmentSchema,
  BETTER_AUTH_SECRET: authSecretSchema,
  BETTER_AUTH_URL: httpOriginSchema,
  AUTH_SIGNUP_MODE: signupModeSchema,
  AUTH_SIGNUP_ALLOWLIST: signupAllowlistSchema,
  MAIL_TRANSPORT: z.enum(["outbox", "smtp"]),
  MAIL_FROM: z.string().trim().max(254).pipe(z.email()),
  MAIL_OUTBOX_DIR: z.string().trim().min(1).max(500).optional(),
  SMTP_URL: smtpUrlSchema.optional(),
}).superRefine((value, context) => {
  if (value.MAIL_TRANSPORT === "outbox") {
    // The file outbox is an explicit development/test transport; production must deliver real email.
    if (value.NODE_ENV === "production") context.addIssue({ code: "custom", path: ["MAIL_TRANSPORT"], message: "invalid" });
    if (!value.MAIL_OUTBOX_DIR) context.addIssue({ code: "custom", path: ["MAIL_OUTBOX_DIR"], message: "invalid" });
  } else if (!value.SMTP_URL) {
    context.addIssue({ code: "custom", path: ["SMTP_URL"], message: "invalid" });
  }
}).transform(({ MAIL_TRANSPORT, MAIL_FROM, MAIL_OUTBOX_DIR, SMTP_URL, ...settings }) => {
  const mail: MailSettings = MAIL_TRANSPORT === "smtp"
    ? { transport: "smtp", from: MAIL_FROM, url: SMTP_URL ?? "" }
    : { transport: "outbox", from: MAIL_FROM, directory: MAIL_OUTBOX_DIR ?? "" };
  return { ...settings, mail };
});
export const workerEnvSchema = databaseEnvSchema.extend({ NODE_ENV: nodeEnvironmentSchema, WORKER_QUEUE_SCHEMA: queueSchema });
export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;
export type WebEnv = z.infer<typeof webEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

const diagnostics = {
  DATABASE_URL: "DATABASE_URL must be a PostgreSQL URL with a host and database name.",
  TEST_DATABASE_URL: "TEST_DATABASE_URL must be a PostgreSQL URL with a host and database name.",
  NODE_ENV: "NODE_ENV must be development, test or production.",
  WORKER_QUEUE_SCHEMA: "WORKER_QUEUE_SCHEMA must be a dedicated lowercase queue schema (1-50 characters).",
  BETTER_AUTH_SECRET: "BETTER_AUTH_SECRET must be a random value of 32-512 characters without spaces or placeholders.",
  BETTER_AUTH_URL: "BETTER_AUTH_URL must be the http(s) origin of the Web app without path, query or credentials.",
  AUTH_SIGNUP_MODE: "AUTH_SIGNUP_MODE must be open or allowlist.",
  AUTH_SIGNUP_ALLOWLIST: "AUTH_SIGNUP_ALLOWLIST must be a comma-separated list of up to 100 email addresses.",
  MAIL_TRANSPORT: "MAIL_TRANSPORT must be outbox (development/test only) or smtp.",
  MAIL_FROM: "MAIL_FROM must be an email address.",
  MAIL_OUTBOX_DIR: "MAIL_OUTBOX_DIR is required for the outbox mail transport.",
  SMTP_URL: "SMTP_URL must be an smtp:// or smtps:// URL when MAIL_TRANSPORT=smtp.",
} as const;
type Setting = keyof typeof diagnostics;

export class EnvironmentConfigurationError extends Error {
  readonly settings: readonly Setting[];
  constructor(scope: string, settings: readonly Setting[]) {
    super(`Invalid ${scope} environment: ${settings.map((setting) => diagnostics[setting]).join(" ")}`);
    this.name = "EnvironmentConfigurationError";
    this.settings = [...settings];
  }
}

function readEnvironment<T extends z.ZodType>(schema: T, environment: Environment, scope: string): z.infer<T> {
  const result = schema.safeParse(environment);
  if (result.success) return result.data;
  const settings = [...new Set(result.error.issues.map((issue) => issue.path[0]))]
    .filter((key): key is Setting => typeof key === "string" && Object.hasOwn(diagnostics, key));
  // Never retain the ZodError, input values or a cause containing credentials.
  throw new EnvironmentConfigurationError(scope, settings);
}
export const readDatabaseEnv = (environment: Environment = processEnvironment): DatabaseEnv => readEnvironment(databaseEnvSchema, environment, "database");
export const readWebEnv = (environment: Environment = processEnvironment): WebEnv => readEnvironment(webEnvSchema, environment, "web");
export const readWorkerEnv = (environment: Environment = processEnvironment): WorkerEnv => readEnvironment(workerEnvSchema, environment, "worker");

export function parseDatabaseUrl(value: unknown, setting: "DATABASE_URL" | "TEST_DATABASE_URL" = "DATABASE_URL"): string {
  const result = postgresUrlSchema.safeParse(value);
  if (!result.success) throw new EnvironmentConfigurationError("database", [setting]);
  return result.data;
}
