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

export const databaseEnvSchema = z.object({ DATABASE_URL: postgresUrlSchema });
export const webEnvSchema = databaseEnvSchema.extend({ NODE_ENV: nodeEnvironmentSchema });
export const workerEnvSchema = databaseEnvSchema.extend({ NODE_ENV: nodeEnvironmentSchema, WORKER_QUEUE_SCHEMA: queueSchema });
export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;
export type WebEnv = z.infer<typeof webEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

const diagnostics = {
  DATABASE_URL: "DATABASE_URL must be a PostgreSQL URL with a host and database name.",
  TEST_DATABASE_URL: "TEST_DATABASE_URL must be a PostgreSQL URL with a host and database name.",
  NODE_ENV: "NODE_ENV must be development, test or production.",
  WORKER_QUEUE_SCHEMA: "WORKER_QUEUE_SCHEMA must be a dedicated lowercase queue schema (1-50 characters).",
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
