import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiFailureSchema, goalDeletionResponseSchema, goalDetailsResponseSchema, goalsPageResponseSchema } from "@lifeos/contracts";
import { createGoalMeasurementsUnitOfWork, createGoalsReadRepository, createGoalsUnitOfWork } from "@lifeos/db";
import { createGoalMeasurementsService, createGoalsReader, createGoalsService } from "@lifeos/domain";
import { createGoalsRoutes } from "../../server/goals.ts";
import { createAuthHarness, databaseOperation, TEST_ORIGIN } from "./support/auth-harness.ts";
import type { AuthHarness, TestUser } from "./support/auth-harness.ts";

// LFS-225 (ADR-013) through HTTP and PostgreSQL: goals without measurements, phases and the start date.
let harness: AuthHarness;
let owner: TestUser;
let other: TestUser;
let routes: ReturnType<typeof createGoalsRoutes>;
const unmeasured = { kind: "unmeasured", domain_key: "work", title: "Найти новую работу" };
const numeric = { domain_key: "finance", title: "Подушка", unit: "NOK", baseline: "0", target: "10000", direction: "increase" };
type Options = { cookie?: string; body?: unknown; key?: string };

beforeAll(async () => {
  harness = await createAuthHarness({ suite: "lfs225_phases", users: ["owner", "other"] });
  owner = await harness.signUp("owner"); other = await harness.signUp("other");
  routes = createGoalsRoutes({ resolveAuth: () => harness.auth,
    resolveGoals: () => createGoalsService(createGoalsUnitOfWork(harness.database.db)),
    resolveMeasurements: () => createGoalMeasurementsService(createGoalMeasurementsUnitOfWork(harness.database.db)),
    resolveReader: () => createGoalsReader(createGoalsReadRepository(harness.database.db)), log: () => {} });
});
afterAll(async () => { await harness?.close(); });

function request(path: string, method: string, { cookie = owner.cookie, body, key = randomUUID() }: Options): Request {
  const headers = new Headers({ cookie });
  if (method !== "GET") headers.set("idempotency-key", key);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`${TEST_ORIGIN}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
const context = (id: string) => ({ params: Promise.resolve({ goalId: id, measurementId: id }) });
const create = (body: unknown, options: Options = {}) => routes.collection.POST(request("/goals", "POST", { ...options, body }));
const patch = (id: string, body: unknown, options: Options = {}) => routes.goal.PATCH(request(`/goals/${id}`, "PATCH", { ...options, body }), context(id));
const get = (id: string, options: Options = {}) => routes.goal.GET(request(`/goals/${id}`, "GET", options), context(id));
async function details(response: Response) {
  expect(response.status).toBe(200);
  const data = goalDetailsResponseSchema.parse(await response.json()).data;
  if (!data) throw new Error("Empty goal response.");
  return data;
}
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(apiFailureSchema.parse(await response.json()).errors[0]?.code).toBe(code);
}
const events = (goalId: string) => databaseOperation(async () => (await harness.database.pool.query<{ event_type: string; payload: { changed_fields?: string[]; before: { phase?: string } | null; after: { phase?: string } } }>(
  "SELECT event_type, payload FROM activity_events WHERE goal_id = $1 ORDER BY occurred_at, created_at", [goalId])).rows);

describe("goals without measurements (LFS-225)", () => {
  it("creates one with its status instead of a percentage; numbers, an unknown kind and a late start are rejected", async () => {
    const goal = await details(await create(unmeasured));
    expect(goal.goal).toMatchObject({ kind: "unmeasured", unit: null, baseline: null, target: null, direction: null, phase: "in_progress", starts_at: null });
    expect(goal.progress).toMatchObject({ status: "unmeasured", progressPercent: null, explanation: "В процессе", methodology: null, measurementCount: 0 });
    expect((await events(goal.goal.id)).map((event) => event.event_type)).toEqual(["goal.created"]);
    await failure(await create({ ...unmeasured, unit: "NOK", baseline: "0", target: "1", direction: "increase" }), 400, "VALIDATION_ERROR");
    await failure(await create({ ...unmeasured, kind: "checklist" }), 400, "VALIDATION_ERROR");
    await failure(await create({ ...unmeasured, starts_at: "2027-02-01T00:00:00Z", due_at: "2027-01-31T22:59:59.999Z" }), 400, "VALIDATION_ERROR");
    const list = goalsPageResponseSchema.parse(await (await routes.collection.GET(request("/goals?domain_key=work", "GET", {}))).json()).data!;
    expect(list.items.find((item) => item.goal.id === goal.goal.id)?.progress.status).toBe("unmeasured");
  });
  it("is planned when it starts later than now and in progress when its start has come", async () => {
    const later = await details(await create({ ...unmeasured, starts_at: "2099-01-01T00:00:00Z" }));
    const started = await details(await create({ ...numeric, starts_at: "2026-01-01T00:00:00Z", due_at: "2099-01-01T00:00:00Z" }));
    expect(later.goal).toMatchObject({ phase: "planned", starts_at: "2099-01-01T00:00:00.000Z" });
    expect(started.goal).toMatchObject({ kind: "numeric", phase: "in_progress", starts_at: "2026-01-01T00:00:00.000Z" });
    expect(later.goal.phase_changed_at).toBe(later.goal.created_at);
  });
  it("refuses a measurement with 409, and PostgreSQL refuses it in a direct insert as well", async () => {
    const goal = await details(await create(unmeasured));
    const response = await routes.measurements.POST(request(`/goals/${goal.goal.id}/measurements`, "POST",
      { body: { value: "1", measured_at: "2026-11-01T00:00:00Z" } }), context(goal.goal.id));
    await failure(response, 409, "CONFLICT");
    const inserted = await databaseOperation(async () => {
      try {
        await harness.database.pool.query("INSERT INTO goal_measurements (user_id, goal_id, unit, value, measured_at) VALUES ($1, $2, 'NOK', 1, now())", [owner.userId, goal.goal.id]);
        return true;
      } catch { return false; }
    });
    expect(inserted).toBe(false);
    expect((await details(await get(goal.goal.id))).progress.measurementCount).toBe(0);
  });
});

describe("phases of any goal (LFS-225)", () => {
  it.each([["unmeasured", unmeasured], ["numeric", numeric]] as const)("moves a %s goal between any two phases with one event each", async (_kind, input) => {
    const goal = await details(await create(input));
    const path = ["achieved", "in_progress", "paused", "planned", "achieved", "paused", "in_progress"] as const;
    let from: string = goal.goal.phase;
    for (const phase of path) {
      const moved = await details(await patch(goal.goal.id, { phase }));
      expect(moved.goal.phase).toBe(phase);
      expect(moved.goal.phase_changed_at > goal.goal.phase_changed_at).toBe(true);
      if (moved.goal.kind === "unmeasured") expect(moved.progress.explanation).toBe({ planned: "Запланирована", in_progress: "В процессе", paused: "На паузе", achieved: "Достигнута" }[phase]);
      const last = (await events(goal.goal.id)).at(-1)!;
      expect(last).toMatchObject({ event_type: "goal.updated", payload: { changed_fields: ["phase"], before: { phase: from }, after: { phase } } });
      from = phase;
    }
    expect((await events(goal.goal.id)).length).toBe(1 + path.length);
  });
  it("keeps the percentage of a numeric goal and its measurements in any phase but archive", async () => {
    const goal = await details(await create(numeric));
    const add = (key = randomUUID()) => routes.measurements.POST(request(`/goals/${goal.goal.id}/measurements`, "POST",
      { body: { value: "4000", measured_at: "2026-11-01T00:00:00Z" }, key }), context(goal.goal.id));
    expect((await add()).status).toBe(200);
    const achieved = await details(await patch(goal.goal.id, { phase: "achieved" }));
    expect(achieved.progress).toMatchObject({ status: "measured", progressPercent: 40 });
    expect((await add()).status).toBe(200);
    expect((await details(await patch(goal.goal.id, { status: "archived" }))).goal).toMatchObject({ status: "archived", phase: "achieved" });
    await failure(await patch(goal.goal.id, { phase: "in_progress" }), 409, "CONFLICT");
    await failure(await add(), 409, "CONFLICT");
    const deleted = await routes.goal.DELETE(request(`/goals/${goal.goal.id}`, "DELETE", {}), context(goal.goal.id));
    expect(goalDeletionResponseSchema.parse(await deleted.json()).data).toMatchObject({ id: goal.goal.id, deleted: true });
  });
  it("replays the same key without a second event, rejects another body with that key, a mixed body and a foreign goal", async () => {
    const goal = await details(await create(unmeasured));
    const key = randomUUID();
    const first = await details(await patch(goal.goal.id, { phase: "achieved" }, { key }));
    const again = await details(await patch(goal.goal.id, { phase: "achieved" }, { key }));
    expect(again.goal).toEqual(first.goal);
    expect((await events(goal.goal.id)).length).toBe(2);
    await failure(await patch(goal.goal.id, { phase: "paused" }, { key }), 409, "CONFLICT");
    await failure(await patch(goal.goal.id, { phase: "paused", title: "x" }), 400, "VALIDATION_ERROR");
    await failure(await patch(goal.goal.id, { phase: "done" }), 400, "VALIDATION_ERROR");
    // The same phase again is a success without a new fact.
    expect((await details(await patch(goal.goal.id, { phase: "achieved" }))).goal.phase).toBe("achieved");
    expect((await events(goal.goal.id)).length).toBe(2);
    await failure(await patch(goal.goal.id, { phase: "paused" }, { cookie: other.cookie }), 404, "NOT_FOUND");
    await failure(await get(goal.goal.id, { cookie: other.cookie }), 404, "NOT_FOUND");
    expect((await details(await get(goal.goal.id))).goal.phase).toBe("achieved");
  });
});

describe("editing a goal without measurements and the start date (LFS-225)", () => {
  it("changes the title, description and dates, never a definition; the start stays before the deadline", async () => {
    const goal = await details(await create({ ...unmeasured, due_at: "2027-03-31T21:59:59.999Z" }));
    const edited = await details(await patch(goal.goal.id, { title: "Найти работу в Осло", description: "Frontend", starts_at: "2026-11-01T00:00:00Z" }));
    expect(edited.goal).toMatchObject({ kind: "unmeasured", title: "Найти работу в Осло", description: "Frontend", starts_at: "2026-11-01T00:00:00.000Z" });
    expect((await events(goal.goal.id)).at(-1)?.payload.changed_fields).toEqual(["title", "description", "starts_at"]);
    await failure(await patch(goal.goal.id, { unit: "NOK", unit_label: null, baseline: "0", target: "1", direction: "increase" }), 409, "CONFLICT");
    await failure(await patch(goal.goal.id, { starts_at: "2027-04-01T00:00:00Z" }), 400, "VALIDATION_ERROR");
    await failure(await patch(goal.goal.id, { due_at: "2026-10-31T22:59:59.999Z" }), 400, "VALIDATION_ERROR");
    expect((await details(await get(goal.goal.id))).goal).toMatchObject({ starts_at: "2026-11-01T00:00:00.000Z", due_at: "2027-03-31T21:59:59.999Z" });
  });
});
