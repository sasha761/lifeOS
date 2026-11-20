import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { currentUserResponseSchema, EMAIL_DELIVERY_FAILED, SIGNUP_NOT_ALLOWED } from "@lifeos/contracts";
import { createDatabase, databaseErrorMessage, readTestDatabaseUrl } from "@lifeos/db";
import { applyMigrations } from "@lifeos/db/migrations";
import type { DatabaseClient } from "@lifeos/db";
import { createSignupPolicy } from "@lifeos/domain";
import { AUTH_COOKIE_PREFIX, createAuth } from "../../server/auth/create-auth.ts";
import type { Auth, AuthDependencies } from "../../server/auth/create-auth.ts";
import { createCurrentUserRoute } from "../../server/auth/session.ts";
import { createOutboxMailSender } from "../../server/mail/outbox.ts";
import { MailDeliveryError } from "../../server/mail/types.ts";

const origin = "http://lifeos.test";
const secret = `lfs201-integration-${randomUUID()}-${randomUUID()}`;
const password = `Initial-pass-${randomUUID().slice(0, 8)}`;
const newPassword = `Changed-pass-${randomUUID().slice(0, 8)}`;
const run = randomUUID().replaceAll("-", "");
const schemaName = `lfs201_auth_${run}`;
if (!/^lfs201_auth_[a-f0-9]{32}$/.test(schemaName)) throw new Error("Invalid isolated test schema name.");
const ownedTables = ["starter_pack_receipts", "goal_deletion_receipts", "goal_measurements", "goal_command_receipts", "activity_events", "goals", "session", "account", "verification", "user", "foundation_migration_fixture", "__drizzle_migrations"];
const allowed = {
  owner: "owner@example.test", sessions: "sessions@example.test", logout: "logout@example.test",
  reset: "reset@example.test", identity: "identity@example.test", other: "other@example.test",
};

let administration: DatabaseClient | undefined;
let client: DatabaseClient | undefined;
let createdSchema = false;
let outbox = "";
let auth: Auth;
let dependencies: AuthDependencies;
const logged: string[] = [];

async function databaseOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(databaseErrorMessage(error));
  }
}

function connection(): DatabaseClient {
  if (!client) throw new Error("The isolated database client was not initialized.");
  return client;
}

async function call(instance: Auth, path: string, options: { body?: unknown; cookie?: string; method?: string } = {}): Promise<Response> {
  const headers = new Headers({ origin });
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  return instance.handler(new Request(`${origin}/api/auth${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  }));
}

function sessionCookie(response: Response): string {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${AUTH_COOKIE_PREFIX}.session_token=`));
  if (!cookie) throw new Error("Session cookie was not set.");
  return cookie.split(";")[0] ?? "";
}

async function signUp(email: string, instance: Auth = auth): Promise<Response> {
  return call(instance, "/sign-up/email", { body: { name: "Fixture User", email, password } });
}

async function signIn(email: string, secretValue: string = password, instance: Auth = auth): Promise<Response> {
  return call(instance, "/sign-in/email", { body: { email, password: secretValue } });
}

async function me(options: { cookie?: string; query?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers(options.headers);
  if (options.cookie) headers.set("cookie", options.cookie);
  const response = await createCurrentUserRoute(() => auth)(new Request(`${origin}/api/v1/me${options.query ?? ""}`, { headers }));
  return { response, body: currentUserResponseSchema.parse(await response.json()) };
}

async function outboxMessages(): Promise<{ to: string; text: string }[]> {
  const files = (await readdir(outbox)).filter((file) => file.endsWith(".json")).sort();
  return Promise.all(files.map(async (file) => JSON.parse(await readFile(join(outbox, file), "utf8")) as { to: string; text: string }));
}

async function tableDump(): Promise<string> {
  return databaseOperation(async () => {
    const rows: unknown[] = [];
    for (const table of ["user", "account", "session", "verification"]) {
      rows.push(...(await connection().pool.query(`SELECT row_to_json(t)::text AS row FROM "${table}" t`)).rows);
    }
    return JSON.stringify(rows);
  });
}

beforeAll(async () => {
  for (const method of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(" ")); });
  }
  outbox = await mkdtemp(join(tmpdir(), "lfs201-outbox-"));
  await databaseOperation(async () => {
    const connectionString = readTestDatabaseUrl(process.env);
    administration = createDatabase({ connectionString });
    // No IF NOT EXISTS: a pre-existing namespace is never claimed or cleaned up.
    await administration.pool.query(`CREATE SCHEMA "${schemaName}"`);
    createdSchema = true;
    const isolated = new URL(connectionString);
    isolated.searchParams.set("options", `-csearch_path=${schemaName}`);
    client = createDatabase({ connectionString: isolated.toString() });
    await applyMigrations(client.db, { migrationsSchema: schemaName });
  });
  dependencies = {
    database: connection().db,
    secret,
    baseURL: origin,
    // Mixed case and padding: matching must be case-insensitive after trimming.
    signupPolicy: createSignupPolicy([" Owner@Example.TEST ", ...Object.values(allowed).slice(1)]),
    mail: createOutboxMailSender({ directory: outbox, from: "no-reply@lifeos.test" }),
    rateLimit: false,
  };
  auth = createAuth(dependencies);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await rm(outbox, { recursive: true, force: true });
  await databaseOperation(async () => {
    await client?.close();
    try {
      if (administration && createdSchema) {
        // Only this run's known tables. RESTRICT preserves unexpected dependencies.
        await administration.pool.query(`DROP TABLE IF EXISTS ${ownedTables.map((table) => `"${schemaName}"."${table}"`).join(", ")}`);
        await administration.pool.query(`DROP SCHEMA "${schemaName}"`);
      }
    } finally {
      await administration?.close();
    }
  });
});

describe("closed registration", () => {
  it("registers an allowlisted email case-insensitively and stores only a password hash", async () => {
    const response = await signUp("OWNER@Example.Test");
    expect(response.status).toBe(200);
    const cookie = sessionCookie(response);
    const current = await me({ cookie });
    expect(current.response.status).toBe(200);
    expect(current.body.data).toMatchObject({ email: allowed.owner, name: "Fixture User" });
    const stored = await databaseOperation(() => connection().pool.query<{ password: string | null; email: string }>(
      `SELECT a.password, u.email FROM account a JOIN "user" u ON u.id = a.user_id WHERE u.email = $1 AND a.provider_id = 'credential'`, [allowed.owner],
    ));
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.password).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(await tableDump()).not.toContain(password);
  });

  it("rejects an email outside the allowlist on the server and creates nothing", async () => {
    const intruder = `intruder-${run}@example.test`;
    const response = await signUp(intruder);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: SIGNUP_NOT_ALLOWED });
    expect(response.headers.getSetCookie().some((value) => value.startsWith(`${AUTH_COOKIE_PREFIX}.session_token=`))).toBe(false);
    const rows = await databaseOperation(() => connection().pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM "user" WHERE email = $1`, [intruder]));
    expect(rows.rows[0]?.count).toBe(0);
  });

  it("does not block sign-in of existing users when the allowlist no longer contains them", async () => {
    const closed = createAuth({ ...dependencies, signupPolicy: createSignupPolicy([]) });
    expect((await signIn(allowed.owner, password, closed)).status).toBe(200);
    expect((await signUp(allowed.other, closed)).status).toBe(403);
  });

  it("rejects a wrong password without creating a session", async () => {
    const response = await signIn(allowed.owner, "wrong-password-123");
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie().some((value) => value.startsWith(`${AUTH_COOKIE_PREFIX}.session_token=`))).toBe(false);
  });
});

describe("sessions and the protected API", () => {
  it("returns 401 in the common envelope without a session", async () => {
    const { response, body } = await me();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.data).toBeNull();
    expect(body.errors).toEqual([{ code: "UNAUTHORIZED", message: "Authentication required." }]);
  });

  it("derives the actor only from the verified session, never from client-supplied identifiers", async () => {
    await signUp(allowed.identity);
    const victim = (await me({ cookie: sessionCookie(await signIn(allowed.owner)) })).body.data;
    const attacker = sessionCookie(await signIn(allowed.identity));
    const forged = await me({ cookie: attacker, query: `?userId=${victim?.id ?? ""}`, headers: { "x-user-id": victim?.id ?? "" } });
    expect(forged.body.data?.email).toBe(allowed.identity);
    const anonymous = await me({ query: `?userId=${victim?.id ?? ""}`, headers: { "x-user-id": victim?.id ?? "" } });
    expect(anonymous.response.status).toBe(401);
    expect((await me({ cookie: `${AUTH_COOKIE_PREFIX}.session_token=forged.value` })).response.status).toBe(401);
  });

  it("keeps the session across requests and rejects it after it expires", async () => {
    await signUp(allowed.sessions);
    const response = await signIn(allowed.sessions);
    const cookie = sessionCookie(response);
    const { token } = await response.json() as { token: string };
    for (let reload = 0; reload < 3; reload++) expect((await me({ cookie })).response.status).toBe(200);
    await databaseOperation(() => connection().pool.query(`UPDATE session SET expires_at = '2000-01-01' WHERE token = $1`, [token]));
    expect((await me({ cookie })).response.status).toBe(401);
  });

  it("invalidates the server-side session on logout, so the old cookie stops working", async () => {
    await signUp(allowed.logout);
    const response = await signIn(allowed.logout);
    const cookie = sessionCookie(response);
    const { token } = await response.json() as { token: string };
    expect((await me({ cookie })).response.status).toBe(200);
    expect((await call(auth, "/sign-out", { method: "POST", body: {}, cookie })).status).toBe(200);
    expect((await me({ cookie })).response.status).toBe(401);
    const rows = await databaseOperation(() => connection().pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM session WHERE token = $1`, [token]));
    expect(rows.rows[0]?.count).toBe(0);
  });
});

describe("password reset", () => {
  let token = "";

  it("emails a one-time link through the dev outbox and stores only a hash of the token", async () => {
    await signUp(allowed.reset);
    const before = (await outboxMessages()).length;
    const response = await call(auth, "/request-password-reset", { body: { email: allowed.reset, redirectTo: "/auth/reset-password" } });
    expect(response.status).toBe(200);
    const messages = await outboxMessages();
    expect(messages).toHaveLength(before + 1);
    const message = messages.at(-1);
    expect(message?.to).toBe(allowed.reset);
    const link = /(http:\/\/lifeos\.test\/api\/auth\/reset-password\/([A-Za-z0-9]+)\?callbackURL=\S+)/.exec(message?.text ?? "");
    expect(link).not.toBeNull();
    token = link?.[2] ?? "";
    const dump = await tableDump();
    expect(dump).not.toContain(token);
    const expected = createHash("sha256").update(`reset-password:${token}`).digest("base64url");
    const rows = await databaseOperation(() => connection().pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM verification WHERE identifier = $1`, [expected]));
    expect(rows.rows[0]?.count).toBe(1);
    // The emailed link validates the token and hands it to the reset page.
    const redirect = await call(auth, (link?.[1] ?? "").slice(`${origin}/api/auth`.length));
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe(`${origin}/auth/reset-password?token=${token}`);
  });

  it("resets the password once, revokes existing sessions and refuses token reuse", async () => {
    const before = sessionCookie(await signIn(allowed.reset));
    expect((await me({ cookie: before })).response.status).toBe(200);
    const reset = await call(auth, "/reset-password", { body: { token, newPassword } });
    expect(reset.status).toBe(200);
    expect((await me({ cookie: before })).response.status).toBe(401);
    expect((await signIn(allowed.reset, password)).status).toBe(401);
    expect((await signIn(allowed.reset, newPassword)).status).toBe(200);
    const reuse = await call(auth, "/reset-password", { body: { token, newPassword: `${newPassword}-again` } });
    expect(reuse.status).toBe(400);
    expect(await reuse.json()).toMatchObject({ code: "INVALID_TOKEN" });
    expect(await tableDump()).not.toContain(newPassword);
  });

  it("rejects an expired token", async () => {
    await call(auth, "/request-password-reset", { body: { email: allowed.reset, redirectTo: "/auth/reset-password" } });
    const expired = /reset-password\/([A-Za-z0-9]+)\?/.exec((await outboxMessages()).at(-1)?.text ?? "")?.[1] ?? "";
    const identifier = createHash("sha256").update(`reset-password:${expired}`).digest("base64url");
    await databaseOperation(() => connection().pool.query(`UPDATE verification SET expires_at = '2000-01-01' WHERE identifier = $1`, [identifier]));
    const response = await call(auth, "/reset-password", { body: { token: expired, newPassword: `${newPassword}-expired` } });
    expect(response.status).toBe(400);
  });

  it("answers unknown emails like known ones without sending anything", async () => {
    const before = (await outboxMessages()).length;
    const response = await call(auth, "/request-password-reset", { body: { email: `nobody-${run}@example.test`, redirectTo: "/auth/reset-password" } });
    expect(response.status).toBe(200);
    expect((await outboxMessages()).length).toBe(before);
  });

  it("reports a delivery failure instead of claiming the email was sent", async () => {
    const failing = createAuth({ ...dependencies, mail: { transport: "smtp", send: () => Promise.reject(new MailDeliveryError()) } });
    const response = await call(failing, "/request-password-reset", { body: { email: allowed.reset, redirectTo: "/auth/reset-password" } });
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ code: EMAIL_DELIVERY_FAILED });
    expect(body).not.toContain("check your email");
    expect(logged.some((line) => line.includes("\"event\":\"mail.delivery_failed\""))).toBe(true);
    // A successful delivery in the same process is unaffected by the previous request's failure.
    const healthy = await call(auth, "/request-password-reset", { body: { email: allowed.reset, redirectTo: "/auth/reset-password" } });
    expect(healthy.status).toBe(200);
  });

  it("never wrote passwords or reset tokens to the logs", () => {
    const output = logged.join("\n");
    expect(token).not.toBe("");
    for (const value of [password, newPassword, token, secret]) expect(output).not.toContain(value);
  });
});
