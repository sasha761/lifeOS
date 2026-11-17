import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { userPreferencesResponseSchema } from "@lifeos/contracts";
import type { UserPreferences } from "@lifeos/contracts";
import { createUserPreferencesRepository } from "@lifeos/db";
import { actorFromVerifiedSession, createUserPreferencesService, DEFAULT_USER_PREFERENCES, NotFoundError } from "@lifeos/domain";
import type { UserPreferencesService } from "@lifeos/domain";
import { createUserPreferencesRoutes } from "../../server/preferences.ts";
import { createAuthHarness, databaseOperation, TEST_ORIGIN } from "./support/auth-harness.ts";
import type { AuthHarness, TestUser } from "./support/auth-harness.ts";

let harness: AuthHarness;
let service: UserPreferencesService;
let routes: ReturnType<typeof createUserPreferencesRoutes>;
let owner: TestUser;
let other: TestUser;
const logged: string[] = [];

type RequestOptions = { cookie?: string; body?: unknown; rawBody?: string; query?: string; headers?: Record<string, string> };

async function request(method: "GET" | "PATCH", options: RequestOptions = {}) {
  const headers = new Headers(options.headers);
  if (options.cookie) headers.set("cookie", options.cookie);
  const body = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await routes[method](new Request(`${TEST_ORIGIN}/api/v1/me/preferences${options.query ?? ""}`, { method, headers, body }));
  return { status: response.status, body: userPreferencesResponseSchema.parse(await response.json()) };
}

/** The stored row, read without any ownership filter. */
async function stored(user: TestUser): Promise<UserPreferences | undefined> {
  return databaseOperation(async () => (await harness.database.pool.query<UserPreferences>(
    `SELECT timezone, locale FROM "user" WHERE id = $1`, [user.userId],
  )).rows[0]);
}

beforeAll(async () => {
  for (const method of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(" ")); });
  }
  harness = await createAuthHarness({ suite: "lfs202_preferences", users: ["owner", "other"] });
  service = createUserPreferencesService(createUserPreferencesRepository(harness.database.db));
  routes = createUserPreferencesRoutes({ resolveAuth: () => harness.auth, resolvePreferences: () => service });
  owner = await harness.signUp("owner");
  other = await harness.signUp("other");
});

afterAll(async () => {
  vi.restoreAllMocks();
  await harness?.close();
});

describe("own preferences", () => {
  it("start with the documented defaults, identical in SQL and in the domain", async () => {
    expect(await stored(owner)).toEqual(DEFAULT_USER_PREFERENCES);
    const response = await request("GET", { cookie: owner.cookie });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(DEFAULT_USER_PREFERENCES);
  });

  it("reject guests with 401 and change nothing", async () => {
    for (const response of [await request("GET"), await request("PATCH", { body: { timezone: "Asia/Tokyo" } })]) {
      expect(response.status).toBe(401);
      expect(response.body.errors.map((error) => error.code)).toEqual(["UNAUTHORIZED"]);
    }
    expect(await stored(owner)).toEqual(DEFAULT_USER_PREFERENCES);
  });

  it("are updated with canonical values for the owner only and survive signing in again", async () => {
    const response = await request("PATCH", { cookie: owner.cookie, body: { timezone: " europe/oslo ", locale: "nb-no" } });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ timezone: "Europe/Oslo", locale: "nb-NO" });
    expect(await stored(owner)).toEqual({ timezone: "Europe/Oslo", locale: "nb-NO" });
    expect(await stored(other)).toEqual(DEFAULT_USER_PREFERENCES);

    expect((await harness.callAuth("/sign-out", { method: "POST", body: {}, cookie: owner.cookie })).status).toBe(200);
    expect((await request("GET", { cookie: owner.cookie })).status).toBe(401);
    const again = await harness.signIn(owner);
    owner = { ...owner, ...again };
    expect((await request("GET", { cookie: owner.cookie })).body.data).toEqual({ timezone: "Europe/Oslo", locale: "nb-NO" });
  });

  it("accept partial updates and keep the other field", async () => {
    const response = await request("PATCH", { cookie: owner.cookie, body: { locale: "en-GB" } });
    expect(response.body.data).toEqual({ timezone: "Europe/Oslo", locale: "en-GB" });
  });

  it.each([
    ["an empty object", "{}"],
    ["a UTC offset", JSON.stringify({ timezone: "+01:00" })],
    ["an unknown zone", JSON.stringify({ timezone: "Mars/Olympus_Mons" })],
    ["a POSIX-style locale", JSON.stringify({ locale: "en_US" })],
    ["an unusable locale", JSON.stringify({ locale: "und" })],
    ["an unknown field", JSON.stringify({ timezone: "UTC", theme: "dark" })],
    ["an array", "[]"],
    ["malformed JSON", "{\"timezone\":"],
  ])("reject %s with 400 and keep the stored values", async (_name, rawBody) => {
    const response = await request("PATCH", { cookie: owner.cookie, rawBody });
    expect(response.status).toBe(400);
    expect(response.body.errors.map((error) => error.code)).toEqual(["VALIDATION_ERROR"]);
    expect(await stored(owner)).toEqual({ timezone: "Europe/Oslo", locale: "en-GB" });
  });
});

describe("another user's preferences", () => {
  it("cannot be targeted with a userId in the body: the request is rejected and nothing changes", async () => {
    const response = await request("PATCH", { cookie: other.cookie, body: { timezone: "Asia/Tokyo", userId: owner.userId } });
    expect(response.status).toBe(400);
    expect(await stored(owner)).toEqual({ timezone: "Europe/Oslo", locale: "en-GB" });
    expect(await stored(other)).toEqual(DEFAULT_USER_PREFERENCES);
  });

  it("cannot be targeted with a userId in the query or a header: the session actor is used", async () => {
    const forged = { query: `?userId=${owner.userId}`, headers: { "x-user-id": owner.userId } };
    const update = await request("PATCH", { cookie: other.cookie, body: { timezone: "Asia/Tokyo" }, ...forged });
    expect(update.status).toBe(200);
    expect(await stored(other)).toEqual({ timezone: "Asia/Tokyo", locale: "ru" });
    expect(await stored(owner)).toEqual({ timezone: "Europe/Oslo", locale: "en-GB" });
    const read = await request("GET", { cookie: other.cookie, ...forged });
    expect(read.body.data).toEqual({ timezone: "Asia/Tokyo", locale: "ru" });
  });

  it("are not reachable through Better Auth's update-user, which drops unknown fields", async () => {
    const response = await harness.callAuth("/update-user", { cookie: owner.cookie, body: { name: "Renamed Owner", timezone: "Invalid/Zone", locale: "zz" } });
    expect(response.status).toBe(200);
    const row = await databaseOperation(async () => (await harness.database.pool.query<{ name: string } & UserPreferences>(
      `SELECT name, timezone, locale FROM "user" WHERE id = $1`, [owner.userId],
    )).rows[0]);
    expect(row).toEqual({ name: "Renamed Owner", timezone: "Europe/Oslo", locale: "en-GB" });
  });

  it("do not exist for an actor without a user row (domain answers NOT_FOUND)", async () => {
    const ghost = actorFromVerifiedSession(`missing-${randomUUID()}`);
    await expect(service.get(ghost)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.update(ghost, { timezone: "UTC" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("never wrote session tokens or passwords to the logs", () => {
    const output = logged.join("\n");
    expect(logged.some((line) => line.includes("\"event\":\"http.request\""))).toBe(true);
    for (const value of [owner.sessionToken, other.sessionToken, owner.password]) expect(output).not.toContain(value);
  });
});
