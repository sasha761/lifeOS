import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityFeedSchema, apiFailureSchema, apiSuccessSchema, goalDetailsResponseSchema, goalMeasurementResponseSchema } from "@lifeos/contracts";
import type { GoalDetails } from "@lifeos/contracts";
import {
  createActivityReadRepository, createDashboardReadRepository, createGoalMeasurementsUnitOfWork, createGoalsReadRepository,
  createGoalsRepository, createGoalsUnitOfWork,
} from "@lifeos/db";
import { createActivityReader, createDashboardReader, createGoalMeasurementsService, createGoalsReader, createGoalsService } from "@lifeos/domain";
import { createActivityRoutes } from "../../server/activity.ts";
import { createGoalsRoutes } from "../../server/goals.ts";
import { createAuthHarness, databaseOperation, TEST_ORIGIN } from "./support/auth-harness.ts";
import type { AuthHarness, TestUser } from "./support/auth-harness.ts";

let harness: AuthHarness;
let owner: TestUser;
let other: TestUser;
let routes: ReturnType<typeof createGoalsRoutes>;
const savings = { domain_key: "finance", title: "Save dollars", unit: "NOK", baseline: "0", target: "5000", direction: "increase" };
const books = { unit: "count", unit_label: null, baseline: "2", target: "10", direction: "increase" } as const;
const feedResponse = apiSuccessSchema(activityFeedSchema);

beforeAll(async () => {
  harness = await createAuthHarness({ suite: "lfs217_definition", users: ["owner", "other"] });
  owner = await harness.signUp("owner"); other = await harness.signUp("other");
  routes = createGoalsRoutes({ resolveAuth: () => harness.auth,
    resolveGoals: () => createGoalsService(createGoalsUnitOfWork(harness.database.db)),
    resolveMeasurements: () => createGoalMeasurementsService(createGoalMeasurementsUnitOfWork(harness.database.db)),
    resolveReader: () => createGoalsReader(createGoalsReadRepository(harness.database.db)), log: () => undefined });
});
afterAll(async () => { await harness?.close(); });

function call(method: "POST" | "PATCH" | "DELETE", path: string, body: unknown, cookie = owner.cookie): Request {
  const headers = new Headers({ cookie, "idempotency-key": randomUUID(), origin: TEST_ORIGIN });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`${TEST_ORIGIN}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
const params = (id: string) => ({ params: Promise.resolve({ goalId: id, measurementId: id }) });
const patch = (id: string, body: unknown, cookie?: string) => routes.goal.PATCH(call("PATCH", `/goals/${id}`, body, cookie), params(id));
const addMeasurement = (id: string, value: string) =>
  routes.measurements.POST(call("POST", `/goals/${id}/measurements`, { value, measured_at: new Date(Date.now() - 60_000).toISOString() }), params(id));
async function createGoal(changes: Record<string, unknown> = {}): Promise<GoalDetails> {
  const response = await routes.collection.POST(call("POST", "/goals", { ...savings, ...changes }));
  expect(response.status).toBe(200);
  return goalDetailsResponseSchema.parse(await response.json()).data!;
}
async function details(response: Response): Promise<GoalDetails> {
  expect(response.status).toBe(200);
  return goalDetailsResponseSchema.parse(await response.json()).data!;
}
async function conflict(response: Response) {
  expect(response.status).toBe(409);
  expect(apiFailureSchema.parse(await response.json()).errors[0]?.code).toBe("CONFLICT");
}
async function journal(goalId: string) {
  const activity = createActivityRoutes({ resolveAuth: () => harness.auth, resolveReader: () => createActivityReader(createActivityReadRepository(harness.database.db)), log: () => undefined });
  const response = await activity.GET(new Request(`${TEST_ORIGIN}/api/v1/activity?goal_id=${goalId}`, { headers: { cookie: owner.cookie } }));
  expect(response.status).toBe(200);
  return feedResponse.parse(await response.json()).data.items;
}
const rows = (goalId: string) => databaseOperation(async () => (await harness.database.pool.query<{ unit: string; goal_unit: string }>(
  "SELECT m.unit, g.unit AS goal_unit FROM goal_measurements m JOIN goals g ON g.id = m.goal_id WHERE m.goal_id = $1", [goalId])).rows);

describe("goal definition edits before the first measurement (LFS-217)", () => {
  it("redefines an unmeasured goal with progress recomputed and the old and new values in the journal", async () => {
    const created = await createGoal();
    const updated = await details(await patch(created.goal.id, { ...books, title: "Read books" }));
    expect(updated.goal).toMatchObject({ title: "Read books", unit: "count", unit_label: null, baseline: "2", target: "10" });
    expect(updated.progress).toMatchObject({ unit: "count", baseline: "2", target: "10", status: "insufficient_data" });
    const [edit] = await journal(created.goal.id);
    expect(edit).toMatchObject({ type: "goal.updated", changedFields: ["title", "unit", "baseline", "target"],
      definition: { before: { unit: "NOK", baseline: "0", target: "5000" }, after: { unit: "count", baseline: "2", target: "10" } } });
    // The same definition again is not a change, and a custom unit needs its label.
    expect((await details(await patch(created.goal.id, books))).goal.updated_at).toBe(updated.goal.updated_at);
    expect((await patch(created.goal.id, { ...books, unit: "custom" })).status).toBe(400);
    expect((await details(await patch(created.goal.id, { ...books, unit: "custom", unit_label: "books" }))).goal.unit_label).toBe("books");
  });

  it("keeps the definition of a measured goal with 409, while metadata with the same definition still saves", async () => {
    const created = await createGoal();
    expect((await addMeasurement(created.goal.id, "1200")).status).toBe(200);
    await conflict(await patch(created.goal.id, { ...books, title: "Changed" }));
    const after = await details(await routes.goal.GET(new Request(`${TEST_ORIGIN}/api/v1/goals/${created.goal.id}`, { headers: { cookie: owner.cookie } }), params(created.goal.id)));
    expect(after.goal).toMatchObject({ title: savings.title, unit: "NOK", target: "5000" });
    const same = { unit: "NOK", unit_label: null, baseline: "0", target: "5000", direction: "increase" };
    expect((await details(await patch(created.goal.id, { ...same, title: "Renamed" }))).goal.title).toBe("Renamed");
  });

  it("hides foreign goals, refuses archived ones and keeps the SQL guard even without the service check", async () => {
    const created = await createGoal();
    expect((await patch(created.goal.id, books, other.cookie)).status).toBe(404);
    const measured = await createGoal();
    expect((await addMeasurement(measured.goal.id, "10")).status).toBe(200);
    expect(await createGoalsRepository(harness.database.db).updateActive(owner.actor, measured.goal.id, { ...books, unit: "NOK", unit_label: null, target: "9000" })).toBeNull();
    expect((await details(await patch(created.goal.id, { status: "archived" }))).goal.status).toBe("archived");
    await conflict(await patch(created.goal.id, books));
  });

  it("serializes a redefinition and a concurrent first measurement: never a measurement in a unit its goal no longer has", async () => {
    for (let round = 0; round < 8; round += 1) {
      const created = await createGoal();
      const [edit, added] = await Promise.all([patch(created.goal.id, { ...books, baseline: "0" }), addMeasurement(created.goal.id, "5")]);
      expect(added.status).toBe(200);
      const measurement = goalMeasurementResponseSchema.parse(await added.json()).data!;
      if (edit.status === 200) expect(measurement.unit).toBe("count");
      else { await conflict(edit); expect(measurement.unit).toBe("NOK"); }
      for (const row of await rows(created.goal.id)) expect(row.unit).toBe(row.goal_unit);
    }
  });

  it("shows measurements entered before a unit change as plain numbers in the journal and on the Dashboard", async () => {
    const created = await createGoal({ title: "Unit change journal" });
    const added = await addMeasurement(created.goal.id, "1200");
    const id = goalMeasurementResponseSchema.parse(await added.json()).data!.id;
    expect((await routes.measurement.DELETE(call("DELETE", `/goal-measurements/${id}`, undefined), params(id))).status).toBe(200);
    await details(await patch(created.goal.id, books));
    expect((await addMeasurement(created.goal.id, "3")).status).toBe(200);
    const entries = await journal(created.goal.id);
    expect(entries.map((entry) => [entry.type, entry.measurement?.value ?? null, entry.measurement?.unit ?? null])).toEqual([
      ["goal_measurement.created", "3", "count"], ["goal.updated", null, null],
      ["goal_measurement.deleted", "1200", null], ["goal_measurement.created", "1200", null], ["goal.created", null, null]]);
    const dashboard = await createDashboardReader(createDashboardReadRepository(harness.database.db)).get(owner.actor);
    const mine = dashboard.activity.filter((item) => item.goal.id === created.goal.id && item.measurement);
    expect(mine.map((item) => [item.measurement!.value, item.measurement!.unit])).toEqual([["3", "count"], ["1200", null], ["1200", null]]);
  });
});
