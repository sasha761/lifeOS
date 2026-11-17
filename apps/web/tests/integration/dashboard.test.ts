import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiFailureSchema, apiSuccessSchema, DASHBOARD_ACTIVITY_LIMIT, DASHBOARD_DUE_GOALS_LIMIT, DASHBOARD_GOALS_PER_DOMAIN, dashboardSchema,
  DOMAIN_KEYS, goalDetailsSchema } from "@lifeos/contracts";
import type { Dashboard, Goal } from "@lifeos/contracts";
import { createDashboardReadRepository, createGoalMeasurementsUnitOfWork, createGoalsReadRepository, createGoalsUnitOfWork, schema } from "@lifeos/db";
import type { LifeosDatabase } from "@lifeos/db";
import { createDashboardReader, createGoalMeasurementsService, createGoalsReader, createGoalsService } from "@lifeos/domain";
import type { GoalMeasurementsService, GoalsService } from "@lifeos/domain";
import { createDashboardRoutes } from "../../server/dashboard.ts";
import { createGoalsRoutes } from "../../server/goals.ts";
import { createAuthHarness, TEST_ORIGIN } from "./support/auth-harness.ts";
import type { AuthHarness, TestUser } from "./support/auth-harness.ts";

let harness: AuthHarness;
let owner: TestUser; let other: TestUser; let empty: TestUser; let bulk: TestUser;
let goals: GoalsService; let measurements: GoalMeasurementsService;
let goalRoutes: ReturnType<typeof createGoalsRoutes>;
const options = () => ({ idempotencyKey: randomUUID(), source: "web" as const });
const success = apiSuccessSchema(dashboardSchema);
const detailSuccess = apiSuccessSchema(goalDetailsSchema);
const past = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

beforeAll(async () => {
  harness = await createAuthHarness({ suite: "lfs204_dashboard", users: ["owner", "other", "empty", "bulk"] });
  [owner, other, empty, bulk] = [await harness.signUp("owner"), await harness.signUp("other"), await harness.signUp("empty"), await harness.signUp("bulk")];
  goals = createGoalsService(createGoalsUnitOfWork(harness.database.db));
  measurements = createGoalMeasurementsService(createGoalMeasurementsUnitOfWork(harness.database.db));
  goalRoutes = createGoalsRoutes({ resolveAuth: () => harness.auth, resolveGoals: () => goals, resolveMeasurements: () => measurements,
    resolveReader: () => createGoalsReader(createGoalsReadRepository(harness.database.db)), log: () => undefined });
});
afterAll(async () => { await harness?.close(); });

function routes(database: LifeosDatabase = harness.database.db) {
  return createDashboardRoutes({ resolveAuth: () => harness.auth, resolveReader: () => createDashboardReader(createDashboardReadRepository(database)), log: () => undefined });
}
function request(cookie?: string, query = ""): Request {
  return new Request(`${TEST_ORIGIN}/api/v1/dashboard${query}`, { headers: cookie ? { cookie } : {} });
}
async function dashboard(user: TestUser, database?: LifeosDatabase): Promise<Dashboard> {
  const response = await routes(database).GET(request(user.cookie));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return success.parse(await response.json()).data;
}
async function details(user: TestUser, goalId: string) {
  const response = await goalRoutes.goal.GET(new Request(`${TEST_ORIGIN}/api/v1/goals/${goalId}`, { headers: { cookie: user.cookie } }), { params: Promise.resolve({ goalId }) });
  expect(response.status).toBe(200);
  return detailSuccess.parse(await response.json()).data;
}
function create(user: TestUser, title: string, extra: Record<string, unknown> = {}): Promise<Goal> {
  return goals.create(user.actor, { domain_key: "finance", title, unit: "NOK", baseline: "0", target: "50000", direction: "increase", ...extra }, options());
}
const sphere = (value: Dashboard, key: string) => value.domains.find((domain) => domain.key === key)!;

describe("GET /api/v1/dashboard (LFS-204)", () => {
  it("requires a verified session and accepts no query input", async () => {
    const guest = await routes().GET(request());
    expect(guest.status).toBe(401);
    expect(guest.headers.get("cache-control")).toBe("no-store");
    expect(apiFailureSchema.parse(await guest.json()).errors.map((error) => error.code)).toEqual(["UNAUTHORIZED"]);
    const forged = await routes().GET(request("lifeos.session_token=forged.value"));
    expect(forged.status).toBe(401);
    for (const query of [`?user_id=${other.userId}`, "?domain_key=finance", "?limit=100"]) {
      const rejected = await routes().GET(request(owner.cookie, query));
      expect(rejected.status).toBe(400);
      expect(apiFailureSchema.parse(await rejected.json()).errors.map((error) => error.code)).toEqual(["VALIDATION_ERROR"]);
    }
  });

  it("shows all six spheres for a user without data and invents nothing", async () => {
    const value = await dashboard(empty);
    expect(value.domains.map((domain) => domain.key)).toEqual([...DOMAIN_KEYS]);
    for (const domain of value.domains) expect(domain).toEqual({ key: domain.key, activeCount: 0, archivedCount: 0, goals: [] });
    expect(value.today.dueGoals).toEqual([]);
    expect(value.activity).toEqual([]);
  });

  it("aggregates two users separately and shows the same progress as goal details after every change", async () => {
    const savings = await create(owner, "Owner savings");
    const deadline = await create(owner, "Owner overdue deadline", { due_at: past(2) });
    const later = await create(owner, "Owner later deadline", { domain_key: "work", unit: "count", target: "10", due_at: future(10) });
    const archived = await create(owner, "Owner archived health goal", { domain_key: "health", unit: "count", target: "3" });
    await goals.archive(owner.actor, archived.id, options());
    const measurement = await measurements.create(owner.actor, savings.id, { value: "12000", measured_at: past(1) }, options());
    const foreign = await create(other, "Other private goal", { domain_key: "languages", unit: "count", target: "20" });
    await measurements.create(other.actor, foreign.id, { value: "5", measured_at: past(1), note: "Other private note" }, options());

    let value = await dashboard(owner);
    expect(sphere(value, "finance")).toMatchObject({ activeCount: 2, archivedCount: 0 });
    expect(sphere(value, "work")).toMatchObject({ activeCount: 1, archivedCount: 0 });
    expect(sphere(value, "health")).toEqual({ key: "health", activeCount: 0, archivedCount: 1, goals: [] });
    expect(sphere(value, "languages")).toEqual({ key: "languages", activeCount: 0, archivedCount: 0, goals: [] });
    expect(sphere(value, "finance").goals.map(({ goal }) => goal.id)).toEqual([deadline.id, savings.id]);
    const shown = () => sphere(value, "finance").goals.find(({ goal }) => goal.id === savings.id)!;
    expect(shown()).toEqual(await details(owner, savings.id));
    expect(shown().progress).toMatchObject({ current: "12000", progressPercent: 24, measurementCount: 1 });
    expect(sphere(value, "finance").goals.find(({ goal }) => goal.id === deadline.id)!.progress)
      .toMatchObject({ current: null, progressPercent: null, explanation: "Недостаточно данных" });
    expect(value.today.dueGoals.map(({ goal }) => goal.id)).toEqual([deadline.id, later.id]);
    expect(value.activity.map((item) => [item.type, item.goal.id])).toEqual([
      ["goal_measurement.created", savings.id], ["goal.archived", archived.id], ["goal.created", archived.id],
      ["goal.created", later.id], ["goal.created", deadline.id], ["goal.created", savings.id],
    ]);
    expect(value.activity[0]).toMatchObject({ source: "web", domainKey: "finance", goal: { title: "Owner savings", status: "active" },
      measurement: { value: "12000", unit: "NOK", unitLabel: null } });
    expect(JSON.stringify(value)).not.toMatch(/Other private|Owner savings note/);

    const foreignView = await dashboard(other);
    expect(sphere(foreignView, "languages").activeCount).toBe(1);
    expect(foreignView.activity).toHaveLength(2);
    expect(JSON.stringify(foreignView)).not.toContain("Owner");
    expect(JSON.stringify(foreignView)).not.toContain("Other private note");

    await measurements.update(owner.actor, measurement.id, { value: "15000" }, options());
    value = await dashboard(owner);
    expect(shown()).toEqual(await details(owner, savings.id));
    expect(shown().progress.progressPercent).toBe(30);
    expect(value.activity[0]).toMatchObject({ type: "goal_measurement.updated", measurement: { value: "15000" } });

    await measurements.remove(owner.actor, measurement.id, options());
    value = await dashboard(owner);
    expect(shown()).toEqual(await details(owner, savings.id));
    expect(shown().progress).toMatchObject({ current: null, progressPercent: null, measurementCount: 0 });
    expect(value.activity[0]).toMatchObject({ type: "goal_measurement.deleted", measurement: { value: "15000" } });

    await goals.update(owner.actor, savings.id, { title: "Owner savings renamed" }, options());
    value = await dashboard(owner);
    expect(shown().goal.title).toBe("Owner savings renamed");
    expect(value.activity[0]).toMatchObject({ type: "goal.updated", goal: { title: "Owner savings renamed" }, measurement: null });
  });

  it("bounds lists while keeping exact counts, with a fixed number of queries (no query per goal)", async () => {
    const count = async (user: TestUser) => {
      let queries = 0;
      const database = drizzle({ client: harness.database.pool, schema, logger: { logQuery: () => { queries += 1; } } });
      const value = await dashboard(user, database);
      return { value, queries };
    };
    const created: Goal[] = [];
    for (let index = 0; index < 12; index += 1) created.push(await create(bulk, `Bulk ${index}`, { domain_key: "skills", unit: "count", target: "5", due_at: future(index + 1) }));
    await measurements.create(bulk.actor, created[11]!.id, { value: "1", measured_at: past(1) }, options());
    const many = await count(bulk);
    const skills = sphere(many.value, "skills");
    expect(skills.activeCount).toBe(12);
    expect(skills.goals.map(({ goal }) => goal.id)).toEqual(created.slice(-DASHBOARD_GOALS_PER_DOMAIN).reverse().map((goal) => goal.id));
    expect(many.value.today.dueGoals.map(({ goal }) => goal.id)).toEqual(created.slice(0, DASHBOARD_DUE_GOALS_LIMIT).map((goal) => goal.id));
    expect(many.value.activity).toHaveLength(DASHBOARD_ACTIVITY_LIMIT);
    expect(many.value.activity[0]!.type).toBe("goal_measurement.created");
    const few = await count(other);
    expect(few.value.domains.reduce((sum, domain) => sum + domain.activeCount, 0)).toBe(1);
    expect(many.queries).toBeGreaterThan(0);
    expect(many.queries).toBe(few.queries);
  });
});
