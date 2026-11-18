import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIVITY_LIMIT_DEFAULT, ACTIVITY_LIMIT_MAX, activityFeedSchema, apiFailureSchema, apiSuccessSchema } from "@lifeos/contracts";
import type { ActivityFeed, Goal } from "@lifeos/contracts";
import { createActivityReadRepository, createGoalMeasurementsUnitOfWork, createGoalsUnitOfWork, schema } from "@lifeos/db";
import type { LifeosDatabase } from "@lifeos/db";
import { createActivityReader, createGoalMeasurementsService, createGoalsService } from "@lifeos/domain";
import type { GoalMeasurementsService, GoalsService } from "@lifeos/domain";
import { createActivityRoutes } from "../../server/activity.ts";
import { createAuthHarness, TEST_ORIGIN } from "./support/auth-harness.ts";
import type { AuthHarness, TestUser } from "./support/auth-harness.ts";

let harness: AuthHarness;
let owner: TestUser; let other: TestUser; let bulk: TestUser;
let goals: GoalsService; let measurements: GoalMeasurementsService;
let savings: Goal; let health: Goal; let foreign: Goal;
const options = () => ({ idempotencyKey: randomUUID(), source: "web" as const });
const success = apiSuccessSchema(activityFeedSchema);
const past = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

beforeAll(async () => {
  harness = await createAuthHarness({ suite: "lfs213_activity", users: ["owner", "other", "bulk"] });
  [owner, other, bulk] = [await harness.signUp("owner"), await harness.signUp("other"), await harness.signUp("bulk")];
  goals = createGoalsService(createGoalsUnitOfWork(harness.database.db));
  measurements = createGoalMeasurementsService(createGoalMeasurementsUnitOfWork(harness.database.db));
  const goal = (user: TestUser, title: string, extra: Record<string, unknown> = {}) =>
    goals.create(user.actor, { domain_key: "finance", title, unit: "NOK", baseline: "0", target: "50000", direction: "increase", ...extra }, options());
  savings = await goal(owner, "Owner savings", { due_at: "2026-11-30T22:59:59.999Z" });
  health = await goal(owner, "Owner steps", { domain_key: "health", unit: "count", target: "10" });
  foreign = await goal(other, "Other savings");
  const row = await measurements.create(owner.actor, savings.id, { value: "8500", measured_at: past(2) }, options());
  await measurements.update(owner.actor, row.id, { value: "12000" }, options());
  await goals.update(owner.actor, savings.id, { title: "Owner savings renamed", due_at: "2026-12-31T22:59:59.999Z" }, options());
  await measurements.create(other.actor, foreign.id, { value: "1", measured_at: past(1) }, options());
});
afterAll(async () => { await harness?.close(); });

function routes(database: LifeosDatabase = harness.database.db) {
  return createActivityRoutes({ resolveAuth: () => harness.auth, resolveReader: () => createActivityReader(createActivityReadRepository(database)), log: () => undefined });
}
function request(cookie?: string, query = ""): Request {
  return new Request(`${TEST_ORIGIN}/api/v1/activity${query}`, { headers: cookie ? { cookie } : {} });
}
async function feed(user: TestUser, query = "", database?: LifeosDatabase): Promise<ActivityFeed> {
  const response = await routes(database).GET(request(user.cookie, query));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return success.parse(await response.json()).data;
}

describe("GET /api/v1/activity (LFS-213)", () => {
  it("requires a verified session before reading the query", async () => {
    for (const query of ["", "?goal_id=bad", `?user_id=${owner.userId}`]) {
      const response = await routes().GET(request(undefined, query));
      expect(response.status).toBe(401);
      expect(apiFailureSchema.parse(await response.json()).errors[0]?.code).toBe("UNAUTHORIZED");
    }
  });

  it("returns the owner's journal newest first with the edit details the payload proves", async () => {
    const value = await feed(owner);
    expect(value.items.map((item) => item.type)).toEqual(["goal.updated", "goal_measurement.updated", "goal_measurement.created", "goal.created", "goal.created"]);
    expect(value.items.every((item) => item.goal.id !== foreign.id)).toBe(true);
    const [edit, correction, added] = value.items;
    expect(edit).toMatchObject({ goal: { id: savings.id, title: "Owner savings renamed" }, measurement: null,
      changedFields: expect.arrayContaining(["title", "due_at"]), dueAt: { before: "2026-11-30T22:59:59.999Z", after: "2026-12-31T22:59:59.999Z" } });
    expect(correction).toMatchObject({ measurement: { value: "12000", previousValue: "8500", unit: "NOK" }, changedFields: null, dueAt: null });
    expect(added).toMatchObject({ measurement: { value: "8500", previousValue: null }, changedFields: null, dueAt: null });
  });

  it("filters by one sphere or one goal and hides foreign or unknown ones without telling them apart", async () => {
    expect((await feed(owner, "?domain_key=health")).items.map((item) => item.goal.id)).toEqual([health.id]);
    const goal = await feed(owner, `?goal_id=${savings.id.toUpperCase()}`);
    expect(goal.items).toHaveLength(4);
    expect(goal.items.every((item) => item.goal.id === savings.id)).toBe(true);
    expect((await feed(owner, `?goal_id=${foreign.id}`)).items).toEqual([]);
    expect((await feed(owner, `?goal_id=${randomUUID()}`)).items).toEqual([]);
    expect((await feed(other)).items.map((item) => item.goal.id)).toEqual([foreign.id, foreign.id]);
    expect((await feed(other, `?goal_id=${savings.id}`)).items).toEqual([]);
  });

  it("rejects both filters, unknown keys, repeated keys and limits outside 1..50", async () => {
    for (const query of [`?domain_key=finance&goal_id=${savings.id}`, `?user_id=${other.userId}`, "?goal_id=bad", "?domain_key=seventh",
      "?limit=0", `?limit=${ACTIVITY_LIMIT_MAX + 1}`, "?limit=1.5", "?limit=1&limit=2", "?cursor=x"]) {
      const response = await routes().GET(request(owner.cookie, query));
      expect(response.status).toBe(400);
      expect(apiFailureSchema.parse(await response.json()).errors[0]?.code).toBe("VALIDATION_ERROR");
    }
  });

  it("bounds the list by limit with one query however long the journal is", async () => {
    const created: Goal[] = [];
    for (let index = 0; index < ACTIVITY_LIMIT_DEFAULT + 3; index += 1) {
      created.push(await goals.create(bulk.actor, { domain_key: "skills", title: `Bulk ${index}`, unit: "count", baseline: "0", target: "5", direction: "increase" }, options()));
    }
    const count = async (query: string) => {
      let queries = 0;
      const database = drizzle({ client: harness.database.pool, schema, logger: { logQuery: () => { queries += 1; } } });
      return { value: await feed(bulk, query, database), queries };
    };
    const byDefault = await count("");
    expect(byDefault.value.items.map((item) => item.goal.id)).toEqual(created.slice(-ACTIVITY_LIMIT_DEFAULT).reverse().map((goal) => goal.id));
    expect((await count("?limit=2")).value.items).toHaveLength(2);
    const all = await count(`?limit=${ACTIVITY_LIMIT_MAX}`);
    expect(all.value.items).toHaveLength(created.length);
    expect(byDefault.queries).toBe(1);
    expect(all.queries).toBe(1);
  });
});
