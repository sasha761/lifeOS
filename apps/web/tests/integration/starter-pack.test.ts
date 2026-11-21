import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiFailureSchema, goalDetailsResponseSchema, goalMeasurementResponseSchema, starterPackAppliedResponseSchema, starterPackRemovedResponseSchema,
} from "@lifeos/contracts";
import type { GoalDetails } from "@lifeos/contracts";
import {
  createDashboardReadRepository, createGoalMeasurementsUnitOfWork, createGoalsReadRepository, createGoalsUnitOfWork, createStarterPackUnitOfWork,
} from "@lifeos/db";
import {
  createDashboardReader, createGoalMeasurementsService, createGoalsReader, createGoalsService, createStarterPackService, STARTER_PACK, STARTER_PACK_NOTE,
} from "@lifeos/domain";
import { createGoalsRoutes } from "../../server/goals.ts";
import { createStarterPackRoutes } from "../../server/starter-pack.ts";
import { createAuthHarness, databaseOperation, TEST_ORIGIN } from "./support/auth-harness.ts";
import type { AuthHarness, TestUser } from "./support/auth-harness.ts";

let harness: AuthHarness;
let goalsRoutes: ReturnType<typeof createGoalsRoutes>;
let starter: ReturnType<typeof createStarterPackRoutes>;
const users = ["owner", "other", "race", "twice", "rollback", "fresh", "namespace", "http"] as const;
const signed = new Map<string, TestUser>();
const user = (label: (typeof users)[number]) => signed.get(label)!;

beforeAll(async () => {
  harness = await createAuthHarness({ suite: "lfs218_starter", users });
  for (const label of users.filter((label) => label !== "fresh")) signed.set(label, await harness.signUp(label));
  goalsRoutes = createGoalsRoutes({ resolveAuth: () => harness.auth,
    resolveGoals: () => createGoalsService(createGoalsUnitOfWork(harness.database.db)),
    resolveMeasurements: () => createGoalMeasurementsService(createGoalMeasurementsUnitOfWork(harness.database.db)),
    resolveReader: () => createGoalsReader(createGoalsReadRepository(harness.database.db)), log: () => undefined });
  starter = createStarterPackRoutes({ resolveAuth: () => harness.auth,
    resolveStarterPack: () => createStarterPackService(createStarterPackUnitOfWork(harness.database.db)), log: () => undefined });
});
afterAll(async () => { await harness?.close(); });

function request(method: string, path: string, { cookie, key = randomUUID(), body, origin = TEST_ORIGIN }: { cookie?: string; key?: string | null; body?: unknown; origin?: string } = {}) {
  const headers = new Headers({ origin });
  if (cookie) headers.set("cookie", cookie);
  if (key) headers.set("idempotency-key", key);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`${TEST_ORIGIN}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
const apply = (who: TestUser, key = randomUUID()) => starter.POST(request("POST", "/starter-pack", { cookie: who.cookie, key }));
const remove = (who: TestUser, key = randomUUID()) => starter.DELETE(request("DELETE", "/starter-pack", { cookie: who.cookie, key }));
const params = (id: string) => ({ params: Promise.resolve({ goalId: id, measurementId: id }) });
async function applied(response: Response) {
  expect(response.status).toBe(200);
  return starterPackAppliedResponseSchema.parse(await response.json());
}
async function removed(response: Response) {
  expect(response.status).toBe(200);
  return starterPackRemovedResponseSchema.parse(await response.json());
}
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(apiFailureSchema.parse(await response.json()).errors[0]?.code).toBe(code);
}
const rows = <T extends Record<string, unknown>>(sql: string, values: unknown[]) => databaseOperation(async () => (await harness.database.pool.query<T>(sql, values)).rows);
const goalsOf = (who: TestUser) => rows<{ id: string; title: string; origin: string; due_at: Date | null; unit: string }>(
  "SELECT id, title, origin, due_at, unit FROM goals WHERE user_id = $1 ORDER BY created_at, id", [who.userId]);
const measurementsOf = (who: TestUser) => rows<{ id: string; goal_id: string; value: string; source: string; note: string | null }>(
  "SELECT id, goal_id, value::text, source, note FROM goal_measurements WHERE user_id = $1 ORDER BY created_at, id", [who.userId]);
const eventsOf = (who: TestUser) => rows<{ event_type: string; source: string; idempotency_key: string | null; goal_id: string; payload: { changed_fields?: string[]; before: { source?: string } | null } }>(
  "SELECT event_type, source, idempotency_key, goal_id, payload FROM activity_events WHERE user_id = $1 ORDER BY occurred_at, id", [who.userId]);
async function details(response: Response): Promise<GoalDetails> {
  expect(response.status).toBe(200);
  return goalDetailsResponseSchema.parse(await response.json()).data!;
}

describe("loading the example (LFS-218)", () => {
  it("creates exactly the set in one command: seven example goals, seven example values, starter facts, one keyed fact and a receipt", async () => {
    const key = randomUUID();
    expect((await applied(await apply(user("owner"), key))).data).toEqual({ version: 1, created_goals: 7, created_measurements: 7 });
    const goals = await goalsOf(user("owner"));
    expect(goals.map((goal) => goal.title)).toEqual(STARTER_PACK.map(({ goal }) => goal.title).reverse());
    expect(goals.every((goal) => goal.origin === "starter" && goal.due_at === null)).toBe(true);
    const measurements = await measurementsOf(user("owner"));
    expect(measurements).toHaveLength(7);
    expect(measurements.every((value) => value.source === "example" && value.note === STARTER_PACK_NOTE)).toBe(true);
    expect(new Set(measurements.map((value) => value.goal_id))).toEqual(new Set(goals.map((goal) => goal.id)));
    const events = await eventsOf(user("owner"));
    expect(events.map((event) => event.event_type)).toEqual([...Array(7).fill("goal.created"), ...Array(7).fill("goal_measurement.created")]);
    expect(events.every((event) => event.source === "starter")).toBe(true);
    expect(events.filter((event) => event.idempotency_key !== null).map((event) => event.idempotency_key)).toEqual([key]);
    expect(await rows("SELECT operation, goals, measurements FROM starter_pack_receipts WHERE user_id = $1", [user("owner").userId]))
      .toEqual([{ operation: "starter_pack.apply", goals: 7, measurements: 7 }]);
  });

  it("replays the same key, refuses a second set with a new key and leaves the first one intact", async () => {
    const key = randomUUID();
    const first = await applied(await apply(user("twice"), key));
    expect((await applied(await apply(user("twice"), key))).data).toEqual(first.data);
    await failure(await apply(user("twice")), 409, "CONFLICT");
    expect(await goalsOf(user("twice"))).toHaveLength(7);
    expect(await measurementsOf(user("twice"))).toHaveLength(7);
  });

  it("never produces two sets from a double click or two tabs", async () => {
    const key = randomUUID();
    const sameKey = await Promise.all([apply(user("race"), key), apply(user("race"), key)]);
    expect(sameKey.map((response) => response.status)).toEqual([200, 200]);
    expect(await goalsOf(user("race"))).toHaveLength(7);
    expect((await removed(await remove(user("race")))).data).toEqual({ deleted_goals: 7 });
    const otherKeys = await Promise.all([apply(user("race")), apply(user("race")), apply(user("race"))]);
    expect(otherKeys.map((response) => response.status).sort()).toEqual([200, 409, 409]);
    expect(await goalsOf(user("race"))).toHaveLength(7);
  });

  it("leaves no part of the set when the transaction fails", async () => {
    // A clock an hour ahead makes the database reject the first example value after all seven goals were inserted.
    const failing = createStarterPackRoutes({ resolveAuth: () => harness.auth, log: () => undefined,
      resolveStarterPack: () => createStarterPackService(createStarterPackUnitOfWork(harness.database.db), () => new Date(Date.now() + 60 * 60 * 1000)) });
    await failure(await failing.POST(request("POST", "/starter-pack", { cookie: user("rollback").cookie })), 500, "INTERNAL_ERROR");
    expect(await goalsOf(user("rollback"))).toEqual([]);
    expect(await eventsOf(user("rollback"))).toEqual([]);
    expect(await rows("SELECT * FROM starter_pack_receipts WHERE user_id = $1", [user("rollback").userId])).toEqual([]);
    expect((await applied(await apply(user("rollback")))).data?.created_goals).toBe(7);
  });

  it("is never created by signing up", async () => {
    const fresh = await harness.signUp("fresh");
    expect(await goalsOf(fresh)).toEqual([]);
    expect((await createDashboardReader(createDashboardReadRepository(harness.database.db)).get(fresh.actor)).examples).toEqual({ goals: 0, measurements: 0 });
  });
});

describe("an example becomes the person's own (LFS-218)", () => {
  it("drops the label on an edit, replaces example values by an own value or a new definition, and refuses to correct an example value", async () => {
    const goals = await goalsOf(user("owner"));
    const byTitle = (title: string) => goals.find((goal) => goal.title === title)!;
    const savings = byTitle("Накопить 5 000 $");
    const edited = await details(await goalsRoutes.goal.PATCH(request("PATCH", `/goals/${savings.id}`, { cookie: user("owner").cookie, body: { title: "Моя подушка" } }), params(savings.id)));
    expect(edited.goal).toMatchObject({ title: "Моя подушка", origin: "manual" });
    expect(edited.progress.provenance).toMatchObject({ kind: "example", source: "example" });
    expect((await eventsOf(user("owner"))).at(-1)).toMatchObject({ event_type: "goal.updated", source: "web", payload: { changed_fields: ["title", "origin"] } });

    const books = byTitle("Прочитать 6 книг по профессии");
    const example = (await measurementsOf(user("owner"))).find((value) => value.goal_id === books.id)!;
    await failure(await goalsRoutes.measurement.PATCH(request("PATCH", `/goal-measurements/${example.id}`, { cookie: user("owner").cookie, body: { value: "3" } }), params(example.id)), 409, "CONFLICT");
    const own = await goalsRoutes.measurements.POST(request("POST", `/goals/${books.id}/measurements`, { cookie: user("owner").cookie,
      body: { value: "3", measured_at: new Date(Date.now() - 60_000).toISOString() } }), params(books.id));
    expect(own.status).toBe(200);
    expect(goalMeasurementResponseSchema.parse(await own.json()).data!.source).toBe("manual");
    expect((await measurementsOf(user("owner"))).filter((value) => value.goal_id === books.id).map((value) => [value.value, value.source])).toEqual([["3", "manual"]]);
    expect((await goalsOf(user("owner"))).find((goal) => goal.id === books.id)!.origin).toBe("manual");
    const facts = (await eventsOf(user("owner"))).filter((event) => event.goal_id === books.id).slice(-3);
    expect(facts.map((event) => [event.event_type, event.payload.changed_fields ?? event.payload.before?.source ?? null])).toEqual([
      ["goal_measurement.deleted", "example"], ["goal.updated", ["origin"]], ["goal_measurement.created", null]]);

    // LFS-217 with an example: a new definition removes the example value first, then the unit may change.
    const chess = byTitle("Рейтинг Lichess 1500");
    const redefined = await details(await goalsRoutes.goal.PATCH(request("PATCH", `/goals/${chess.id}`, { cookie: user("owner").cookie,
      body: { unit: "count", unit_label: null, baseline: "1100", target: "1500", direction: "increase" } }), params(chess.id)));
    expect(redefined.goal).toMatchObject({ unit: "count", baseline: "1100", origin: "manual" });
    expect(redefined.progress).toMatchObject({ current: null, measurementCount: 0 });
    expect((await measurementsOf(user("owner"))).filter((value) => value.goal_id === chess.id)).toEqual([]);
  });

  it("counts the remaining examples for the banner", async () => {
    const dashboard = await createDashboardReader(createDashboardReadRepository(harness.database.db)).get(user("owner").actor);
    // Savings keeps its example value although the goal is the person's own now (a metadata edit).
    expect(dashboard.examples).toEqual({ goals: 4, measurements: 5 });
    expect(dashboard.activity.some((item) => item.example && item.source === "starter")).toBe(true);
  });
});

describe("«Удалить все примеры» (LFS-218)", () => {
  it("deletes only goals still labelled as examples with their values, history and receipts, replays the count and allows a new set", async () => {
    const owner = user("owner");
    const manual = await details(await goalsRoutes.collection.POST(request("POST", "/goals", { cookie: owner.cookie,
      body: { domain_key: "work", title: "Своя цель", unit: "count", baseline: "0", target: "3", direction: "increase" } })));
    const [onboarding] = await rows<{ id: string }>(`INSERT INTO goals (user_id, domain_key, title, unit, baseline, target, direction, origin)
      VALUES ($1, 'skills', 'Из мастера', 'count', 0, 5, 'increase', 'onboarding') RETURNING id`, [owner.userId]);
    const before = await goalsOf(owner);
    const examples = before.filter((goal) => goal.origin === "starter");
    expect(examples).toHaveLength(4);
    await apply(user("other"));
    const otherBefore = await goalsOf(user("other"));
    const key = randomUUID();
    expect((await removed(await remove(owner, key))).data).toEqual({ deleted_goals: 4 });
    const after = await goalsOf(owner);
    expect(after.map((goal) => goal.id).sort()).toEqual(before.filter((goal) => goal.origin !== "starter").map((goal) => goal.id).sort());
    expect(after.map((goal) => goal.id)).toEqual(expect.arrayContaining([manual.goal.id, onboarding!.id]));
    const gone = examples.map((goal) => goal.id);
    expect(await rows("SELECT id FROM goal_measurements WHERE goal_id = ANY($1::uuid[])", [gone])).toEqual([]);
    expect(await rows("SELECT id FROM activity_events WHERE goal_id = ANY($1::uuid[])", [gone])).toEqual([]);
    expect(await rows("SELECT goal_id FROM goal_command_receipts WHERE goal_id = ANY($1::uuid[])", [gone])).toEqual([]);
    expect(await goalsOf(user("other"))).toEqual(otherBefore);
    expect((await removed(await remove(owner, key))).data).toEqual({ deleted_goals: 4 });
    expect((await removed(await remove(owner))).data).toEqual({ deleted_goals: 0 });
    expect((await applied(await apply(owner))).data?.created_goals).toBe(7);
    expect((await goalsOf(owner)).filter((goal) => goal.origin === "starter")).toHaveLength(7);
  });

  it("keeps one key namespace with the goal commands", async () => {
    const who = user("namespace");
    const key = randomUUID();
    await applied(await apply(who, key));
    await failure(await goalsRoutes.collection.POST(request("POST", "/goals", { cookie: who.cookie, key,
      body: { domain_key: "work", title: "Своя", unit: "count", baseline: "0", target: "3", direction: "increase" } })), 409, "CONFLICT");
    await failure(await remove(who, key), 409, "CONFLICT");
    const goalKey = randomUUID();
    expect((await goalsRoutes.collection.POST(request("POST", "/goals", { cookie: who.cookie, key: goalKey,
      body: { domain_key: "work", title: "Своя", unit: "count", baseline: "0", target: "3", direction: "increase" } }))).status).toBe(200);
    await failure(await apply(who, goalKey), 409, "CONFLICT");
  });
});

describe("HTTP boundary of /api/v1/starter-pack (LFS-218)", () => {
  it.each(["POST", "DELETE"] as const)("%s: needs a session, the public origin, a key and no body or query", async (method) => {
    const route = starter[method];
    const who = user("http");
    await failure(await route(request(method, "/starter-pack")), 401, "UNAUTHORIZED");
    await failure(await route(request(method, "/starter-pack", { cookie: who.cookie, origin: "https://evil.test" })), 403, "FORBIDDEN");
    await failure(await route(request(method, "/starter-pack", { cookie: who.cookie, key: null })), 400, "VALIDATION_ERROR");
    await failure(await route(request(method, "/starter-pack", { cookie: who.cookie, body: { version: 1 } })), 400, "VALIDATION_ERROR");
    await failure(await route(new Request(`${TEST_ORIGIN}/api/v1/starter-pack?all=1`, { method, headers: { cookie: who.cookie, origin: TEST_ORIGIN, "idempotency-key": randomUUID() } })), 400, "VALIDATION_ERROR");
    expect(await goalsOf(who)).toEqual([]);
  });
});
