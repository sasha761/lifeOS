import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, databaseErrorMessage, readTestDatabaseUrl } from "@lifeos/db";
import { applyMigrations } from "@lifeos/db/migrations";
import type { DatabaseClient } from "@lifeos/db";
import { actorFromVerifiedSession, createSignupPolicy } from "@lifeos/domain";
import type { Actor } from "@lifeos/domain";
import { AUTH_COOKIE_PREFIX, createAuth } from "../../../server/auth/create-auth.ts";
import type { Auth } from "../../../server/auth/create-auth.ts";
import { createOutboxMailSender } from "../../../server/mail/outbox.ts";

/**
 * Shared integration setup (LFS-202): a fresh PostgreSQL schema in TEST_DATABASE_URL with all
 * application migrations, the real Better Auth instance and allowlisted test users. Suites for
 * future owned resources (goals, measurements, events) reuse it together with ownership-contract.ts.
 */
export const TEST_ORIGIN = "http://lifeos.test";
// Tables created by the application migrations; cleanup drops only these plus a suite's own fixtures.
const MIGRATION_TABLES = ["starter_pack_receipts", "goal_deletion_receipts", "goal_measurements", "goal_command_receipts", "activity_events", "goals", "session", "account", "verification", "user", "foundation_migration_fixture", "__drizzle_migrations"];

export type TestUser = {
  label: string;
  email: string;
  password: string;
  userId: string;
  /** Built from the id Better Auth returned at sign-up, i.e. the same value a verified session yields. */
  actor: Actor;
  /** `name=value` of the session cookie for request headers. */
  cookie: string;
  /** Raw session token (database value) of that cookie. */
  sessionToken: string;
};

export type AuthCallOptions = { body?: unknown; cookie?: string; method?: string };

export type AuthHarness = {
  schemaName: string;
  database: DatabaseClient;
  auth: Auth;
  callAuth(path: string, options?: AuthCallOptions): Promise<Response>;
  signUp(label: string): Promise<TestUser>;
  /** A new session for an existing user, as after signing in again. */
  signIn(user: TestUser): Promise<Pick<TestUser, "cookie" | "sessionToken">>;
  close(): Promise<void>;
};

/** Re-throws database failures with the safe message only (no SQL, credentials or row data). */
export async function databaseOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(databaseErrorMessage(error));
  }
}

function sessionCookie(response: Response): string {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${AUTH_COOKIE_PREFIX}.session_token=`));
  if (!cookie) throw new Error("Session cookie was not set.");
  return cookie.split(";")[0] ?? "";
}

/**
 * @param suite   schema prefix such as `lfs202_owner`; a random suffix makes every run unique.
 * @param users   labels of users that may sign up (the allowlist); emails are derived from them.
 * @param fixtureTables  test-only tables the suite creates in its schema and wants dropped.
 */
export async function createAuthHarness(options: { suite: string; users: readonly string[]; fixtureTables?: readonly string[]; secret?: string }): Promise<AuthHarness> {
  const run = randomUUID().replaceAll("-", "");
  const schemaName = `${options.suite}_${run}`;
  if (!/^lfs\d{3}_[a-z]+_[a-f0-9]{32}$/.test(schemaName)) throw new Error("Invalid isolated test schema name.");
  for (const table of options.fixtureTables ?? []) if (!/^[a-z_]+$/.test(table)) throw new Error("Invalid fixture table name.");
  const emailFor = (label: string) => `${label}-${run}@example.test`;
  const password = `Fixture-pass-${randomUUID().slice(0, 8)}`;

  const connectionString = readTestDatabaseUrl(process.env);
  const administration = createDatabase({ connectionString });
  let database: DatabaseClient | undefined;
  let createdSchema = false;
  const outbox = await mkdtemp(join(tmpdir(), `${options.suite}-outbox-`));

  async function close(): Promise<void> {
    await rm(outbox, { recursive: true, force: true });
    await databaseOperation(async () => {
      await database?.close();
      try {
        if (createdSchema) {
          const tables = [...(options.fixtureTables ?? []), ...MIGRATION_TABLES].map((table) => `"${schemaName}"."${table}"`);
          // Only this run's known tables. RESTRICT preserves unexpected dependencies.
          await administration.pool.query(`DROP TABLE IF EXISTS ${tables.join(", ")}`);
          await administration.pool.query(`DROP SCHEMA "${schemaName}"`);
        }
      } finally {
        await administration.close();
      }
    });
  }

  try {
    await databaseOperation(async () => {
      // No IF NOT EXISTS: a pre-existing namespace is never claimed or cleaned up.
      await administration.pool.query(`CREATE SCHEMA "${schemaName}"`);
      createdSchema = true;
      const isolated = new URL(connectionString);
      isolated.searchParams.set("options", `-csearch_path=${schemaName}`);
      database = createDatabase({ connectionString: isolated.toString() });
      await applyMigrations(database.db, { migrationsSchema: schemaName });
    });
  } catch (error) {
    await close();
    throw error;
  }
  if (!database) throw new Error("The isolated database client was not initialized.");
  const client = database;

  const auth = createAuth({
    database: client.db,
    secret: options.secret ?? `${options.suite}-${randomUUID()}-${randomUUID()}`,
    baseURL: TEST_ORIGIN,
    signupPolicy: createSignupPolicy(options.users.map(emailFor)),
    mail: createOutboxMailSender({ directory: outbox, from: "no-reply@lifeos.test" }),
    rateLimit: false,
  });

  async function callAuth(path: string, call: AuthCallOptions = {}): Promise<Response> {
    const headers = new Headers({ origin: TEST_ORIGIN });
    if (call.body !== undefined) headers.set("content-type", "application/json");
    if (call.cookie) headers.set("cookie", call.cookie);
    return auth.handler(new Request(`${TEST_ORIGIN}/api/auth${path}`, {
      method: call.method ?? (call.body === undefined ? "GET" : "POST"),
      headers,
      body: call.body === undefined ? undefined : JSON.stringify(call.body),
      redirect: "manual",
    }));
  }

  async function signUp(label: string): Promise<TestUser> {
    const email = emailFor(label);
    const response = await callAuth("/sign-up/email", { body: { name: `Fixture ${label}`, email, password } });
    if (response.status !== 200) throw new Error(`Sign-up of the "${label}" test user failed with HTTP ${response.status}.`);
    const body = await response.json() as { token: string; user: { id: string } };
    return { label, email, password, userId: body.user.id, actor: actorFromVerifiedSession(body.user.id), cookie: sessionCookie(response), sessionToken: body.token };
  }

  async function signIn(user: TestUser): Promise<Pick<TestUser, "cookie" | "sessionToken">> {
    const response = await callAuth("/sign-in/email", { body: { email: user.email, password: user.password } });
    if (response.status !== 200) throw new Error(`Sign-in of the "${user.label}" test user failed with HTTP ${response.status}.`);
    const body = await response.json() as { token: string };
    return { cookie: sessionCookie(response), sessionToken: body.token };
  }

  return { schemaName, database: client, auth, callAuth, signUp, signIn, close };
}
