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
const users = ["owner", "other", "replay", "invalid", "rollback", "again", "namespace", "http", "choice", "final", "neighbour", "rhythm", "example", "late", "popup"] as const;
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
const patch = (who: TestUser, body: unknown) => routes.state.PATCH(request("PATCH", "/onboarding", { cookie: who.cookie, key: null, body }));
const WIZARD = { status: "in_progress", choice: "wizard" };
const BLANK = { status: "dismissed", choice: "blank" };
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
    const failing: OnboardingUnitOfWork = { ...real, run: (actor, command, operation) => real.run(actor, command, async (transaction) => {
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

describe("start choice of the popup and Settings (LFS-220)", () => {
  it("moves a new account to the questions or a blank start, keeps the draft and repeats without change", async () => {
    const who = user("choice");
    expect(await stateOf(await patch(who, WIZARD))).toMatchObject({ status: "in_progress", choice: "wizard", answers: null, completed_at: null });
    expect(await stateOf(await patch(who, WIZARD))).toMatchObject({ status: "in_progress", choice: "wizard" });
    await stateOf(await draft(who, { answers: answers("skills") }));
    const dismissed = await stateOf(await patch(who, BLANK));
    expect(dismissed).toMatchObject({ status: "dismissed", choice: "blank", completed_at: null });
    expect(dismissed.answers?.step).toBe("skills");
    expect(await stateOf(await patch(who, BLANK))).toMatchObject({ status: "dismissed", choice: "blank" });
    // After «Начать с чистого листа» the questions are still open.
    expect(await stateOf(await patch(who, WIZARD))).toMatchObject({ status: "in_progress", choice: "wizard" });
    expect(await goalsOf(who)).toEqual([]);
  });

  it("refuses to reopen or dismiss a completed setup with 409 and changes nothing", async () => {
    const who = user("final");
    await completed(await complete(who, { answers: answers(), selected: ["health.training"] }));
    const [before] = await stateRow(who);
    for (const body of [WIZARD, BLANK]) await failure(await patch(who, body), 409, "CONFLICT");
    expect(await stateRow(who)).toEqual([before]);
  });

  it("changes only the row of the session owner; another account stays as it was", async () => {
    const who = user("neighbour");
    const bystander = user("other");
    const before = await stateRow(bystander);
    const profile = await profileOf(bystander);
    await stateOf(await patch(who, BLANK));
    await stateOf(await patch(who, { checkin_rhythm: "daily" }));
    expect(await stateRow(bystander)).toEqual(before);
    expect(await profileOf(bystander)).toEqual(profile);
    expect(await stateRow(who)).toEqual([expect.objectContaining({ status: "dismissed", choice: "blank" })]);
    // The body cannot name another owner.
    await failure(await patch(who, { ...BLANK, user_id: bystander.userId }), 400, "VALIDATION_ERROR");
  });

  it("stores the rhythm from Settings and reports the profile values and goal counts", async () => {
    const who = user("rhythm");
    expect(await stateOf(await state(who))).toMatchObject({ checkin_rhythm: null, focus_domains: [], goals: { total: 0, onboarding: 0, examples: 0 } });
    expect(await stateOf(await patch(who, { checkin_rhythm: "weekly" }))).toMatchObject({ status: "not_started", checkin_rhythm: "weekly" });
    expect(await stateRow(who)).toEqual([]);
    await completed(await complete(who, { answers: answers(), selected: SELECTED }));
    await stateOf(await patch(who, { checkin_rhythm: "daily" }));
    expect(await profileOf(who)).toMatchObject({ checkin_rhythm: "daily", focus_domains: ["languages", "finance", "skills", "health"] });
    expect(await stateOf(await state(who))).toMatchObject({ checkin_rhythm: "daily", focus_domains: ["languages", "finance", "skills", "health"],
      goals: { total: 4, onboarding: 4, examples: 0 } });
    for (const body of [{ checkin_rhythm: "hourly" }, { checkin_rhythm: null }, { status: "completed", choice: "example" }, {}]) {
      await failure(await patch(who, body), 400, "VALIDATION_ERROR");
    }
  });

  it("completes the start with the example in the same transaction; a completed setup keeps its date", async () => {
    const who = user("example");
    await stateOf(await patch(who, WIZARD));
    expect((await starter.POST(request("POST", "/starter-pack", { cookie: who.cookie }))).status).toBe(200);
    const [row] = await stateRow(who);
    expect(row).toMatchObject({ status: "completed", choice: "example" });
    expect(await stateOf(await state(who))).toMatchObject({ status: "completed", choice: "example", goals: { total: 7, onboarding: 0, examples: 7 } });
    // Removed and loaded again: the status and the date of the first completion stay.
    expect((await starter.DELETE(request("DELETE", "/starter-pack", { cookie: who.cookie }))).status).toBe(200);
    expect((await starter.POST(request("POST", "/starter-pack", { cookie: who.cookie }))).status).toBe(200);
    expect(await stateRow(who)).toEqual([row]);

    const late = user("late");
    await completed(await complete(late, { answers: answers(), selected: ["health.training"] }));
    const [wizard] = await stateRow(late);
    expect((await starter.POST(request("POST", "/starter-pack", { cookie: late.cookie }))).status).toBe(200);
    expect(await stateRow(late)).toEqual([wizard]);
    expect(await stateOf(await state(late))).toMatchObject({ status: "completed", choice: "wizard", goals: { total: 8, onboarding: 1, examples: 7 } });
  });

  it("shows the first-visit popup on the dashboard only while the account is empty and the setup is open", async () => {
    const who = user("popup");
    const reader = createDashboardReader(createDashboardReadRepository(harness.database.db));
    expect((await reader.get(who.actor)).onboarding).toEqual({ status: "not_started", show_start: true });
    await stateOf(await patch(who, WIZARD));
    expect((await reader.get(who.actor)).onboarding).toEqual({ status: "in_progress", show_start: true });
    const goal = await goalsRoutes.collection.POST(request("POST", "/goals", { cookie: who.cookie,
      body: { domain_key: "work", title: "Своя цель", unit: "count", baseline: "0", target: "3", direction: "increase" } }));
    expect(goal.status).toBe(200);
    expect((await reader.get(who.actor)).onboarding).toEqual({ status: "in_progress", show_start: false });
    await stateOf(await patch(who, BLANK));
    expect((await reader.get(who.actor)).onboarding).toEqual({ status: "dismissed", show_start: false });
  });

  it("needs a session and the public origin for PATCH and rejects a query", async () => {
    const who = user("http");
    await failure(await routes.state.PATCH(request("PATCH", "/onboarding", { key: null, body: BLANK })), 401, "UNAUTHORIZED");
    await failure(await routes.state.PATCH(request("PATCH", "/onboarding", { cookie: who.cookie, key: null, origin: "https://evil.test", body: BLANK })), 403, "FORBIDDEN");
    await failure(await routes.state.PATCH(new Request(`${TEST_ORIGIN}/api/v1/onboarding?user_id=x`, { method: "PATCH",
      headers: { cookie: who.cookie, origin: TEST_ORIGIN, "content-type": "application/json" }, body: JSON.stringify(BLANK) })), 400, "VALIDATION_ERROR");
    expect(await stateRow(who)).toEqual([]);
  });
});
