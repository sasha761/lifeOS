import { parseDatabaseUrl as parseConfiguredDatabaseUrl } from "@lifeos/config/env";

type DatabaseSetting = "DATABASE_URL" | "TEST_DATABASE_URL";

export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

export function parseDatabaseUrl(value: unknown, setting: DatabaseSetting = "DATABASE_URL"): string {
  try {
    return parseConfiguredDatabaseUrl(value, setting);
  } catch {
    throw new DatabaseConfigurationError(`${setting} must be a PostgreSQL URL with a host and database name.`);
  }
}

export function readTestDatabaseUrl(environment: NodeJS.ProcessEnv): string {
  const value = parseDatabaseUrl(environment.TEST_DATABASE_URL, "TEST_DATABASE_URL");
  const test = new URL(value);
  if (!/^\/lifeos_test(?:_[a-z0-9_]+)?$/.test(test.pathname)) {
    throw new DatabaseConfigurationError("TEST_DATABASE_URL must target a dedicated lifeos_test database.");
  }
  if (environment.DATABASE_URL) {
    const application = new URL(parseDatabaseUrl(environment.DATABASE_URL));
    const host = (url: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ? "loopback" : url.hostname.toLowerCase();
    if (host(application) === host(test) && (application.port || "5432") === (test.port || "5432") && application.pathname === test.pathname) {
      throw new DatabaseConfigurationError("TEST_DATABASE_URL must be different from DATABASE_URL.");
    }
  }
  return value;
}

export function databaseErrorMessage(error: unknown): string {
  if (error instanceof DatabaseConfigurationError) return error.message;
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (typeof code === "string" && /^(?:[A-Z0-9]{5}|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET)$/.test(code)) {
    return `Database operation failed (${code}).`;
  }
  return "Database operation failed. Check local configuration and PostgreSQL availability.";
}
