import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiFailureSchema, onboardingCompletedResponseSchema, onboardingStateResponseSchema } from "@lifeos/contracts";
import {
  createDashboardReadRepository, createGoalsReadRepository, createGoalsUnitOfWork, createGoalMeasurementsUnitOfWork, createOnboardingUnitOfWork,
  createStarterPackUnitOfWork,
} from "@lifeos/db";
import type { OnboardingUnitOfWork } from "@lifeos/domain";
import {
  createDashboardReader, createGoalMeasurementsService, createGoalsReader, createGoalsService, createOnboardingService, createStarterPackService,
} from "@lifeos/domain";
import { createGoalsRoutes } from "../../server/goals.ts";
import { createOnboardingRoutes } from "../../server/onboarding.ts";
import { createStarterPackRoutes } from "../../server/starter-pack.ts";
import { createAuthHarness, databaseOperation, TEST_ORIGIN } from "./support/auth-harness.ts";
import type { AuthHarness, TestUser } from "./support/auth-harness.ts";

let harness: AuthHarness;
let routes: ReturnType<typeof createOnboardingRoutes>;
let goalsRoutes: ReturnType<typeof createGoalsRoutes>;
let starter: ReturnType<typeof createStarterPackRoutes>;
const users = ["owner", "other", "replay", "invalid", "rollback", "again", "namespace", "http"] as const;
const signed = new Map<string, TestUser>();
const user = (label: (typeof users)[number]) => signed.get(label)!;

beforeAll(async () => {
  harness = await createAuthHarness({ suite: "lfs219_onboarding", users });
  for (const label of users) signed.set(label, await harness.signUp(label));
  routes = createOnboardingRoutes({ resolveAuth: () => harness.auth, resolveOnboarding: () => createOnboardingService(createOnboardingUnitOfWork(harness.database.db)), log: () => undefined });
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
const choice = (option: string, values: Record<string, unknown> = {}) =>
  ({ option, subject: "", direction: "increase", unit: "custom", unit_label: "", baseline: "", target: "", due_at: null, ...values });
/** Four spheres, one skipped, a template, a language, Health with «Свой вариант» and an unticked goal (test values). */
const answers = (step = "summary") => ({
  step, domains: ["languages", "finance", "skills", "health"], rhythm: "few_per_week", timezone: "Europe/Oslo", extra: [], unchecked: ["health.sleep"],
  spheres: {
    languages: { skipped: false, choices: [choice("norwegian", { baseline: "2", target: "3", due_at: "2027-05-31T21:59:59.999Z" })] },
    finance: { skipped: false, choices: [choice("emergency_fund", { unit: "USD", target: "4 500", baseline: "700" })] },
    skills: { skipped: true, choices: [choice("chess", { baseline: "900", target: "1200" })] },
    health: { skipped: false, choices: [choice("training", { baseline: "1", target: "3" }), choice("sleep", { baseline: "6", target: "8" }),
      choice("own", { subject: "Проплыть 2 км", unit_label: "метров", baseline: "500", target: "2000" })] },
  },
});
const SELECTED = ["languages.norwegian", "finance.emergency_fund", "health.training", "health.own"];
const draft = (who: TestUser, body: unknown) => routes.state.PUT(request("PUT", "/onboarding", { cookie: who.cookie, key: null, body }));
const state = (who: TestUser) => routes.state.GET(request("GET", "/onboarding", { cookie: who.cookie, key: null }));
const complete = (who: TestUser, body: unknown, key = randomUUID()) => routes.complete.POST(request("POST", "/onboarding/complete", { cookie: who.cookie, key, body }));
async function stateOf(response: Response) {
  expect(response.status).toBe(200);
  return onboardingStateResponseSchema.parse(await response.json()).data!;
}
async function completed(response: Response) {
  expect(response.status).toBe(200);
  return onboardingCompletedResponseSchema.parse(await response.json()).data!;
}
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const body = apiFailureSchema.parse(await response.json());
  expect(body.errors[0]?.code).toBe(code);
  return body.errors[0]!;
}
const rows = <T extends Record<string, unknown>>(sql: string, values: unknown[]) => databaseOperation(async () => (await harness.database.pool.query<T>(sql, values)).rows);
const goalsOf = (who: TestUser) => rows<{ id: string; domain_key: string; title: string; origin: string; unit: string; unit_label: string | null; baseline: string; target: string; due_at: Date | null }>(
  "SELECT id, domain_key, title, origin, unit, unit_label, baseline::text, target::text, due_at FROM goals WHERE user_id = $1 ORDER BY created_at, id", [who.userId]);
const eventsOf = (who: TestUser) => rows<{ event_type: string; source: string; idempotency_key: string | null; goal_id: string }>(
  "SELECT event_type, source, idempotency_key, goal_id FROM activity_events WHERE user_id = $1 ORDER BY occurred_at, id", [who.userId]);
const profileOf = (who: TestUser) => rows<{ focus_domains: string[] | null; checkin_rhythm: string | null; timezone: string }>(
  `SELECT focus_domains, checkin_rhythm, timezone FROM "user" WHERE id = $1`, [who.userId]).then((result) => result[0]!);
const stateRow = (who: TestUser) => rows<{ status: string; choice: string | null; completed_at: Date | null; catalog_version: number }>(
  "SELECT status, choice, completed_at, catalog_version FROM onboarding_state WHERE user_id = $1", [who.userId]);

describe("onboarding draft (LFS-219)", () => {
  it("is saved and read back only by its owner; a new account has not started", async () => {
    expect(await stateOf(await state(user("owner")))).toMatchObject({ status: "not_started", choice: null, answers: null, completed_at: null });
    const saved = await stateOf(await draft(user("owner"), { answers: answers("health") }));
    expect(saved).toMatchObject({ status: "in_progress", choice: "wizard", catalog_version: 1, completed_at: null });
    expect(saved.answers).toMatchObject({ step: "health", domains: ["languages", "finance", "skills", "health"] });
    expect((await stateOf(await state(user("owner")))).answers?.spheres.finance?.choices[0]?.target).toBe("4 500");
    // The other account sees only its own (empty) state; the draft is not shared or addressable.
    expect(await stateOf(await state(user("other")))).toMatchObject({ status: "not_started", answers: null });
    expect(await goalsOf(user("owner"))).toEqual([]);
  });
});

describe("«Создать N целей» (LFS-219)", () => {
  it("creates exactly the ticked goals without measurements, with web audit facts, the profile and the completed state", async () => {
    const owner = user("owner");
    const key = randomUUID();
    expect(await completed(await complete(owner, { answers: answers(), selected: SELECTED }, key))).toEqual({ catalog_version: 1, created_goals: 4 });
    const goals = await goalsOf(owner);
    expect(goals.map((goal) => [goal.domain_key, goal.title, goal.origin])).toEqual([
      ["languages", "Норвежский до B1", "onboarding"], ["finance", "Подушка безопасности", "onboarding"],
      ["health", "Тренировки 3 раза в неделю", "onboarding"], ["health", "Проплыть 2 км", "onboarding"]]);
    expect(goals[1]).toMatchObject({ unit: "USD", baseline: "700", target: "4500", due_at: null });
    expect(goals[0]).toMatchObject({ unit: "custom", unit_label: "уровень (A1=1 … C2=6)", baseline: "2", target: "3" });
    expect(goals[0]!.due_at?.toISOString()).toBe("2027-05-31T21:59:59.999Z");
    expect(await rows("SELECT id FROM goal_measurements WHERE user_id = $1", [owner.userId])).toEqual([]);
    const events = await eventsOf(owner);
    expect(events.map((event) => [event.event_type, event.source])).toEqual(goals.map(() => ["goal.created", "web"]));
    expect(events.map((event) => event.idempotency_key)).toEqual([key, null, null, null]);
    expect(await profileOf(owner)).toEqual({ focus_domains: ["languages", "finance", "skills", "health"], checkin_rhythm: "few_per_week", timezone: "Europe/Oslo" });
    const [row] = await stateRow(owner);
    expect(row).toMatchObject({ status: "completed", choice: "wizard", catalog_version: 1 });
    expect(row!.completed_at).toBeInstanceOf(Date);
    const after = await stateOf(await state(owner));
    expect(after.answers).toMatchObject({ step: "domains", extra: [], unchecked: [] });
    expect(await rows("SELECT goals FROM onboarding_receipts WHERE user_id = $1", [owner.userId])).toEqual([{ goals: 4 }]);
    // Dashboard: «Недостаточно данных» for every new goal, the chosen spheres as focus, DTO order unchanged.
    const dashboard = await createDashboardReader(createDashboardReadRepository(harness.database.db)).get(owner.actor);
    expect(dashboard.focus_domains).toEqual(["languages", "finance", "skills", "health"]);
    expect(dashboard.domains.map((domain) => domain.key)).toEqual(["languages", "finance", "work", "projects", "skills", "health"]);
    expect(dashboard.domains.flatMap((domain) => domain.goals).every(({ progress }) => progress.current === null && progress.progressPercent === null)).toBe(true);
    // The other account is untouched.
    expect(await goalsOf(user("other"))).toEqual([]);
    expect(await profileOf(user("other"))).toEqual({ focus_domains: null, checkin_rhythm: null, timezone: "UTC" });
  });

  it("replays a retry with the same key without creating goals again; the same key with other data is a conflict", async () => {
    const who = user("replay");
    const key = randomUUID();
    const body = { answers: answers(), selected: SELECTED };
    const parallel = await Promise.all([complete(who, body, key), complete(who, body, key)]);
    expect(parallel.map((response) => response.status)).toEqual([200, 200]);
    expect(await completed(await complete(who, body, key))).toEqual({ catalog_version: 1, created_goals: 4 });
    expect(await goalsOf(who)).toHaveLength(4);
    await failure(await complete(who, { answers: answers(), selected: SELECTED.slice(0, 2) }, key), 409, "CONFLICT");
    expect(await goalsOf(who)).toHaveLength(4);
  });

  it("names the goal that does not pass and creates none of them", async () => {
    const who = user("invalid");
    const broken = answers();
    broken.spheres.health.choices[2] = choice("own", { subject: "Проплыть 2 км", unit_label: "метров", baseline: "2000", target: "2000" });
    expect((await failure(await complete(who, { answers: broken, selected: SELECTED }), 400, "VALIDATION_ERROR")).field).toBe("health.own");
    expect((await failure(await complete(who, { answers: answers(), selected: ["skills.chess"] }), 400, "VALIDATION_ERROR")).field).toBe("skills.chess");
    expect((await failure(await complete(who, { answers: { ...answers(), timezone: "Mars/Olympus" }, selected: SELECTED }), 400, "VALIDATION_ERROR")).field).toBe("timezone");
    expect(await goalsOf(who)).toEqual([]);
    expect(await stateRow(who)).toEqual([]);
    expect(await profileOf(who)).toMatchObject({ focus_domains: null, checkin_rhythm: null });
  });

  it("rolls back every goal, fact, profile change, state and receipt when the transaction fails", async () => {
    const who = user("rollback");
    await stateOf(await draft(who, { answers: answers("summary") }));
    const real = createOnboardingUnitOfWork(harness.database.db);
    // The work runs in the real transaction; failing after it proves that nothing of it is committed.
    const failing: OnboardingUnitOfWork = { state: real.state, run: (actor, command, operation) => real.run(actor, command, async (transaction) => {
      await operation(transaction);
      throw new Error("forced failure after the goals were written");
    }) };
    const broken = createOnboardingRoutes({ resolveAuth: () => harness.auth, resolveOnboarding: () => createOnboardingService(failing), log: () => undefined });
    await failure(await broken.complete.POST(request("POST", "/onboarding/complete", { cookie: who.cookie, body: { answers: answers(), selected: SELECTED } })), 500, "INTERNAL_ERROR");
    expect(await goalsOf(who)).toEqual([]);
    expect(await eventsOf(who)).toEqual([]);
    expect(await profileOf(who)).toMatchObject({ focus_domains: null, checkin_rhythm: null, timezone: "UTC" });
    expect(await stateRow(who)).toEqual([expect.objectContaining({ status: "in_progress", completed_at: null })]);
    expect(await rows("SELECT * FROM onboarding_receipts WHERE user_id = $1", [who.userId])).toEqual([]);
    expect((await completed(await complete(who, { answers: answers(), selected: SELECTED }))).created_goals).toBe(4);
  });

  it("adds goals on a repeated setup and deletes nothing; a later draft keeps the setup completed", async () => {
    const who = user("again");
    const manual = await goalsRoutes.collection.POST(request("POST", "/goals", { cookie: who.cookie,
      body: { domain_key: "work", title: "Своя цель", unit: "count", baseline: "0", target: "3", direction: "increase" } }));
    expect(manual.status).toBe(200);
    expect(await completed(await complete(who, { answers: answers(), selected: ["finance.emergency_fund"] }))).toMatchObject({ created_goals: 1 });
    const draftAfter = await stateOf(await draft(who, { answers: { ...answers("finance"), rhythm: null, timezone: null } }));
    expect(draftAfter.status).toBe("completed");
    expect(draftAfter.completed_at).not.toBeNull();
    expect(await completed(await complete(who, { answers: { ...answers(), rhythm: null, timezone: null }, selected: ["finance.emergency_fund", "health.training"] }))).toMatchObject({ created_goals: 2 });
    expect((await goalsOf(who)).map((goal) => [goal.title, goal.origin])).toEqual([
      ["Своя цель", "manual"], ["Подушка безопасности", "onboarding"], ["Подушка безопасности", "onboarding"], ["Тренировки 3 раза в неделю", "onboarding"]]);
    // A skipped rhythm and an unchanged zone keep what the profile already had.
    expect(await profileOf(who)).toMatchObject({ checkin_rhythm: "few_per_week", timezone: "Europe/Oslo" });
  });

  it("keeps one key namespace with the goal and example commands", async () => {
    const who = user("namespace");
    const key = randomUUID();
    await completed(await complete(who, { answers: answers(), selected: ["health.training"] }, key));
    const goalBody = { domain_key: "work", title: "Своя", unit: "count", baseline: "0", target: "3", direction: "increase" };
    await failure(await goalsRoutes.collection.POST(request("POST", "/goals", { cookie: who.cookie, key, body: goalBody })), 409, "CONFLICT");
    await failure(await starter.POST(request("POST", "/starter-pack", { cookie: who.cookie, key })), 409, "CONFLICT");
    const goalKey = randomUUID();
    expect((await goalsRoutes.collection.POST(request("POST", "/goals", { cookie: who.cookie, key: goalKey, body: goalBody }))).status).toBe(200);
    await failure(await complete(who, { answers: answers(), selected: ["health.training"] }, goalKey), 409, "CONFLICT");
    expect((await goalsOf(who)).filter((goal) => goal.origin === "onboarding")).toHaveLength(1);
  });
});

describe("HTTP boundary of /api/v1/onboarding (LFS-219)", () => {
  it("needs a session for every method, the public origin for writes and a key for «Создать»", async () => {
    const who = user("http");
    await failure(await routes.state.GET(request("GET", "/onboarding")), 401, "UNAUTHORIZED");
    await failure(await routes.state.PUT(request("PUT", "/onboarding", { body: { answers: answers() } })), 401, "UNAUTHORIZED");
    await failure(await routes.complete.POST(request("POST", "/onboarding/complete", { body: { answers: answers(), selected: SELECTED } })), 401, "UNAUTHORIZED");
    await failure(await routes.state.PUT(request("PUT", "/onboarding", { cookie: who.cookie, origin: "https://evil.test", body: { answers: answers() } })), 403, "FORBIDDEN");
    await failure(await routes.complete.POST(request("POST", "/onboarding/complete", { cookie: who.cookie, origin: "https://evil.test", body: { answers: answers(), selected: SELECTED } })), 403, "FORBIDDEN");
    await failure(await routes.complete.POST(request("POST", "/onboarding/complete", { cookie: who.cookie, key: null, body: { answers: answers(), selected: SELECTED } })), 400, "VALIDATION_ERROR");
    await failure(await draft(who, { answers: answers(), user_id: user("other").userId }), 400, "VALIDATION_ERROR");
    await failure(await draft(who, answers()), 400, "VALIDATION_ERROR");
    await failure(await routes.state.GET(new Request(`${TEST_ORIGIN}/api/v1/onboarding?user_id=x`, { headers: { cookie: who.cookie } })), 400, "VALIDATION_ERROR");
    await failure(await routes.state.PUT(new Request(`${TEST_ORIGIN}/api/v1/onboarding`, { method: "PUT", headers: { cookie: who.cookie, origin: TEST_ORIGIN, "content-type": "text/plain" }, body: "{}" })), 400, "VALIDATION_ERROR");
    expect(await goalsOf(who)).toEqual([]);
    expect(await stateRow(who)).toEqual([]);
  });
});
