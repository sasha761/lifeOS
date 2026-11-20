import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiFailureSchema, goalDetailsResponseSchema, goalMeasurementDeletionResponseSchema, goalMeasurementResponseSchema,
  goalsPageResponseSchema, measurementsPageResponseSchema } from "@lifeos/contracts";
import { createGoalsReadRepository, createGoalsUnitOfWork, createGoalMeasurementsUnitOfWork } from "@lifeos/db";
import type { LifeosDatabase } from "@lifeos/db";
import { createGoalsReader, createGoalsService, createGoalMeasurementsService } from "@lifeos/domain";
import { createGoalsRoutes } from "../../server/goals.ts";
import type { HttpEvent } from "../../server/api-route.ts";
import { createAuthHarness, databaseOperation, TEST_ORIGIN } from "./support/auth-harness.ts";
import type { AuthHarness, TestUser } from "./support/auth-harness.ts";
import { expectHttpOwnership } from "./support/ownership-contract.ts";

let harness: AuthHarness;
let owner: TestUser;
let other: TestUser;
let routes: ReturnType<typeof createGoalsRoutes>;
const logs: HttpEvent[] = [];
const definition = { domain_key: "finance", title: "Private savings", unit: "NOK", baseline: "0", target: "50000", direction: "increase" };
const measurement = { value: "12000", measured_at: "2020-01-02T00:00:00Z", note: "Private note" };
type Route = "collection" | "goal" | "measurements" | "measurement";
type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Options = { cookie?: string; body?: unknown; rawBody?: string; key?: string | null; query?: URLSearchParams; headers?: Record<string, string> };

beforeAll(async () => {
  harness = await createAuthHarness({ suite: "lfs207_api", users: ["owner", "other"] });
  owner = await harness.signUp("owner"); other = await harness.signUp("other");
  routes = createGoalsRoutes({ resolveAuth: () => harness.auth,
    resolveGoals: () => createGoalsService(createGoalsUnitOfWork(harness.database.db)),
    resolveMeasurements: () => createGoalMeasurementsService(createGoalMeasurementsUnitOfWork(harness.database.db)),
    resolveReader: () => createGoalsReader(createGoalsReadRepository(harness.database.db)), log: (event) => { logs.push(event); } });
});
afterAll(async () => { await harness?.close(); });
function request(route: Route, method: Method, id: string, options: Options): Request {
  const path = route === "collection" ? "/goals" : route === "goal" ? `/goals/${id}` : route === "measurements" ? `/goals/${id}/measurements` : `/goal-measurements/${id}`;
  const headers = new Headers(options.headers);
  if (options.cookie) headers.set("cookie", options.cookie);
  if (method !== "GET" && options.key !== null) headers.set("idempotency-key", options.key ?? randomUUID());
  const body = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`${TEST_ORIGIN}/api/v1${path}${options.query ? `?${options.query}` : ""}`, { method, headers, body });
}
function raw(route: Route, method: Method, id = "", options: Options = {}): Promise<Response> {
  const req = request(route, method, id, options);
  const context = { params: Promise.resolve({ goalId: id, measurementId: id }) };
  if (route === "collection") return routes.collection[method as "GET" | "POST"](req);
  if (route === "goal") return routes.goal[method as "GET" | "PATCH" | "DELETE"](req, context);
  if (route === "measurements") return routes.measurements[method as "GET" | "POST"](req, context);
  return routes.measurement[method as "PATCH" | "DELETE"](req, context);
}
async function createGoal(changes: Record<string, unknown> = {}, key?: string, cookie?: string) {
  const response = await raw("collection", "POST", "", { cookie: cookie ?? owner.cookie, body: { ...definition, ...changes }, key });
  expect(response.status).toBe(200);
  const data = goalDetailsResponseSchema.parse(await response.json()).data;
  if (!data) throw new Error("Goal response was empty.");
  return data;
}
async function createMeasurement(id: string, changes: Record<string, unknown> = {}, key?: string) {
  const response = await raw("measurements", "POST", id, { cookie: owner.cookie, body: { ...measurement, ...changes }, key });
  expect(response.status).toBe(200);
  const data = goalMeasurementResponseSchema.parse(await response.json()).data;
  if (!data) throw new Error("Measurement response was empty.");
  return data;
}
async function get(id: string) {
  const response = await raw("goal", "GET", id, { cookie: owner.cookie });
  expect(response.status).toBe(200);
  return goalDetailsResponseSchema.parse(await response.json()).data!;
}
async function counts() {
  return databaseOperation(async () => (await harness.database.pool.query<{ goals: number; measurements: number; events: number; receipts: number }>(
    `SELECT (SELECT count(*)::int FROM goals) AS goals, (SELECT count(*)::int FROM goal_measurements) AS measurements,
     (SELECT count(*)::int FROM activity_events) AS events, (SELECT count(*)::int FROM goal_command_receipts) AS receipts`,
  )).rows[0]!);
}
async function history(id: string, query: URLSearchParams) {
  const response = await raw("measurements", "GET", id, { cookie: owner.cookie, query });
  expect(response.status).toBe(200);
  return measurementsPageResponseSchema.parse(await response.json()).data!;
}
async function page(query: URLSearchParams, cookie = owner.cookie) {
  const response = await raw("collection", "GET", "", { cookie, query });
  expect(response.status).toBe(200);
  return goalsPageResponseSchema.parse(await response.json()).data!;
}

describe("goals HTTP and progress", () => {
  it("guards all nine endpoints before reading malformed bodies, queries or identifiers", async () => {
    for (const [route, method] of [["collection", "GET"], ["collection", "POST"], ["goal", "GET"], ["goal", "PATCH"],
      ["goal", "DELETE"], ["measurements", "GET"], ["measurements", "POST"], ["measurement", "PATCH"], ["measurement", "DELETE"]] as const) {
      for (const cookie of [undefined, "lifeos.session_token=forged.value"]) {
        const response = await raw(route, method, "invalid-id", { cookie, rawBody: ["POST", "PATCH"].includes(method) ? "{bad" : undefined, key: null, query: new URLSearchParams({ limit: "bad" }) });
        expect(response.status).toBe(401);
        expect(apiFailureSchema.parse(await response.json()).errors).toEqual([{ code: "UNAUTHORIZED", message: "Authentication required." }]);
      }
    }
  });

  it("distinguishes no data from zero, computes savings/debt and exposes methodology and provenance", async () => {
    const created = await createGoal();
    expect(created.progress).toMatchObject({ current: null, progressPercent: null, explanation: "Недостаточно данных", measurementCount: 0, provenance: null });
    const zero = await createMeasurement(created.goal.id, { value: "0", measured_at: "2020-01-01T00:00:00Z" });
    expect((await get(created.goal.id)).progress).toMatchObject({ current: "0", progressPercent: 0, measurementCount: 1, provenance: { measurementId: zero.id } });
    const measured = await createMeasurement(created.goal.id);
    const value = await get(created.goal.id);
    expect(value.progress).toMatchObject({ current: "12000", progressPercent: 24, source: "manual", unit: "NOK", baseline: "0", target: "50000", measurementCount: 2,
      methodology: { version: 1, formula: "(current-baseline)/(target-baseline)", rounding: "half_up", percentDecimals: 2, clamped: true },
      provenance: { kind: "self_report", measurementId: measured.id, source: "manual", measuredAt: measured.measured_at, recordedAt: measured.created_at } });
    expect(value.progress.updatedAt >= measured.updated_at).toBe(true);
    expect(JSON.stringify(value.progress)).not.toContain(measurement.note);
    const debt = await createGoal({ baseline: "100000", target: "0", direction: "decrease" });
    await createMeasurement(debt.goal.id, { value: "80000" });
    expect((await get(debt.goal.id)).progress).toMatchObject({ progressPercent: 20, current: "80000", methodology: { formula: "(baseline-current)/(baseline-target)" } });
  });

  it("preserves adjacent large NOK amounts, clamps only the display and updates after edit/delete", async () => {
    const parent = await createGoal({ baseline: "9007199254740993.01", target: "9007199254740993.05" });
    const row = await createMeasurement(parent.goal.id, { value: "9007199254740993.02" });
    expect((await get(parent.goal.id)).progress.progressPercent).toBe(25);
    const edit = await raw("measurement", "PATCH", row.id, { cookie: owner.cookie, body: { value: "9007199254740993.06" } });
    expect(edit.status).toBe(200);
    expect(goalMeasurementResponseSchema.parse(await edit.json()).data?.value).toBe("9007199254740993.06");
    const latest = await get(parent.goal.id);
    expect(latest.progress).toMatchObject({ current: "9007199254740993.06", progressPercent: 100 });
    const deleted = await raw("measurement", "DELETE", row.id, { cookie: owner.cookie });
    expect(deleted.status).toBe(200);
    expect(goalMeasurementDeletionResponseSchema.parse(await deleted.json()).data).toMatchObject({ id: row.id, deleted: true });
    const empty = await get(parent.goal.id);
    expect(empty.progress).toMatchObject({ current: null, progressPercent: null, measurementCount: 0 });
    expect(empty.progress.updatedAt >= latest.progress.updatedAt).toBe(true);
  });

  it("enforces HTTP ownership for goals and measurements with no distinguishable foreign ids", async () => {
    const parent = await createGoal();
    const row = await createMeasurement(parent.goal.id);
    await expectHttpOwnership({ users: { owner, other }, ownedId: parent.goal.id, ownerSecrets: [parent.goal.title, measurement.value, measurement.note], snapshot: counts,
      requests: [
        { name: "goal read", send: (id, cookie) => raw("goal", "GET", id, { cookie }) },
        { name: "goal edit", send: (id, cookie) => raw("goal", "PATCH", id, { cookie, body: { title: "Forged" } }) },
        { name: "goal archive", send: (id, cookie) => raw("goal", "PATCH", id, { cookie, body: { status: "archived" } }) },
        { name: "goal delete", send: (id, cookie) => raw("goal", "DELETE", id, { cookie }) },
        { name: "history", send: (id, cookie) => raw("measurements", "GET", id, { cookie }) },
        { name: "measurement create", send: (id, cookie) => raw("measurements", "POST", id, { cookie, body: measurement }) },
      ] });
    await expectHttpOwnership({ users: { owner, other }, ownedId: row.id, ownerSecrets: [measurement.note], snapshot: counts,
      requests: [
        { name: "measurement edit", send: (id, cookie) => raw("measurement", "PATCH", id, { cookie, body: { note: null } }) },
        { name: "measurement delete", send: (id, cookie) => raw("measurement", "DELETE", id, { cookie }) },
      ] });
    const foreign = await createGoal({}, undefined, other.cookie);
    const list = await page(new URLSearchParams(), other.cookie);
    expect(list.items.map((item) => item.goal.id)).toEqual([foreign.goal.id]);
    expect(await get(parent.goal.id)).toMatchObject({ goal: { title: definition.title }, progress: { current: measurement.value } });
    for (const id of ["invalid", randomUUID()]) expect((await raw("goal", "GET", id, { cookie: owner.cookie })).status).toBe(404);
  });

  it("replays every write endpoint without duplicate effects and conflicts on changed inputs", async () => {
    const goalKey = randomUUID();
    const created = await createGoal({}, goalKey);
    const before = await counts();
    expect((await createGoal({}, goalKey)).goal.id).toBe(created.goal.id);
    const create = randomUUID();
    const [one, two] = await Promise.all([createMeasurement(created.goal.id, {}, create), createMeasurement(created.goal.id, {}, create)]);
    expect(one.id).toBe(two.id);
    const editKey = randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) expect((await raw("measurement", "PATCH", one.id, { cookie: owner.cookie, key: editKey, body: { value: "13000.00" } })).status).toBe(200);
    const metadataKey = randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) expect((await raw("goal", "PATCH", created.goal.id, { cookie: owner.cookie, key: metadataKey, body: { title: "Updated private title" } })).status).toBe(200);
    const deleteKey = randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) expect((await raw("measurement", "DELETE", one.id, { cookie: owner.cookie, key: deleteKey })).status).toBe(200);
    expect((await raw("measurements", "POST", created.goal.id, { cookie: owner.cookie, body: measurement, key: create })).status).toBe(404);
    const archiveKey = randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) expect((await raw("goal", "PATCH", created.goal.id, { cookie: owner.cookie, key: archiveKey, body: { status: "archived" } })).status).toBe(200);
    for (const response of [
      await raw("collection", "POST", "", { cookie: owner.cookie, key: goalKey, body: { ...definition, title: "Changed" } }),
      await raw("measurements", "POST", created.goal.id, { cookie: owner.cookie, key: goalKey, body: measurement }),
      await raw("measurement", "PATCH", one.id, { cookie: owner.cookie, key: editKey, body: { value: "14000" } }),
    ]) {
      expect(response.status).toBe(409);
      expect(apiFailureSchema.parse(await response.json()).errors[0]?.code).toBe("CONFLICT");
    }
    expect(await counts()).toEqual({ goals: before.goals, measurements: before.measurements, events: before.events + 5, receipts: before.receipts + 5 });
  });

  it("archives without hard delete, preserves reads and prevents edits, new measurements or reopening", async () => {
    const parent = await createGoal();
    const row = await createMeasurement(parent.goal.id);
    expect((await raw("goal", "PATCH", parent.goal.id, { cookie: owner.cookie, body: { status: "archived" } })).status).toBe(200);
    expect((await get(parent.goal.id)).goal.status).toBe("archived");
    expect((await history(parent.goal.id, new URLSearchParams())).items).toHaveLength(1);
    for (const response of [await raw("goal", "PATCH", parent.goal.id, { cookie: owner.cookie, body: { title: "Edit" } }),
      await raw("measurements", "POST", parent.goal.id, { cookie: owner.cookie, body: measurement }),
      await raw("measurement", "PATCH", row.id, { cookie: owner.cookie, body: { note: null } }),
      await raw("measurement", "DELETE", row.id, { cookie: owner.cookie })]) expect(response.status).toBe(409);
    expect((await raw("goal", "PATCH", parent.goal.id, { cookie: owner.cookie, body: { status: "active" } })).status).toBe(400);
  });

  it("paginates history beyond the old 100-row cap with stable tuple ties and a deleted cursor row", async () => {
    const parent = await createGoal();
    // Direct fixture seed only in this isolated schema; HTTP success/audit is tested above.
    await databaseOperation(async () => { await harness.database.pool.query(`INSERT INTO goal_measurements (goal_id,user_id,unit,value,measured_at,created_at)
      SELECT $1,$2,'NOK',n,'2020-01-01Z','2020-02-01Z' FROM generate_series(1,105) n`, [parent.goal.id, owner.userId]); });
    const first = await history(parent.goal.id, new URLSearchParams({ limit: "100" }));
    expect(first.items).toHaveLength(100);
    expect(first.measurementCount).toBe(105);
    expect(first.nextCursor).toBeTruthy();
    const cursorRow = first.items.at(-1)!;
    expect((await raw("measurement", "DELETE", cursorRow.id, { cookie: owner.cookie })).status).toBe(200);
    const second = await history(parent.goal.id, new URLSearchParams({ limit: "100", cursor: first.nextCursor! }));
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(second.measurementCount).toBe(104);
    const ids = [...first.items, ...second.items].map((row) => row.id);
    expect(new Set(ids).size).toBe(105);
    expect(ids).toEqual([...ids].sort().reverse());
    expect((await get(parent.goal.id)).progress.measurementCount).toBe(104);
    const foreignGoal = await createGoal();
    expect((await raw("measurements", "GET", foreignGoal.goal.id, { cookie: owner.cookie, query: new URLSearchParams({ cursor: first.nextCursor! }) })).status).toBe(400);
  });

  it("seeks across measured_at then created_at before UUID and keeps backdated inserts from changing current", async () => {
    const parent = await createGoal();
    const a = await createMeasurement(parent.goal.id, { value: "1", measured_at: "2020-01-03T00:00:00Z" });
    const b = await createMeasurement(parent.goal.id, { value: "2", measured_at: "2020-01-02T00:00:00Z" });
    const c = await createMeasurement(parent.goal.id, { value: "3", measured_at: "2020-01-02T00:00:00Z" });
    await databaseOperation(async () => { await harness.database.pool.query(`UPDATE goal_measurements SET created_at = CASE WHEN id=$1 THEN '2020-03-02Z'::timestamptz ELSE '2020-03-01Z'::timestamptz END WHERE id IN ($1,$2)`, [b.id, c.id]); });
    const read: string[] = [];
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ limit: "1" });
      if (cursor) query.set("cursor", cursor);
      const result = await history(parent.goal.id, query);
      read.push(...result.items.map((row) => row.id)); cursor = result.nextCursor;
    } while (cursor);
    expect(read).toEqual([a.id, b.id, c.id]);
    expect((await get(parent.goal.id)).progress.current).toBe("1");
  });

  it("paginates goal lists with domain/status filters, includes empty goals and scopes seek positions", async () => {
    const parents = await Promise.all(Array.from({ length: 3 }, () => createGoal({ domain_key: "projects" })));
    await createGoal({ domain_key: "health" });
    await createGoal({ domain_key: "projects" }, undefined, other.cookie);
    const row = await createMeasurement(parents[0].goal.id);
    await databaseOperation(async () => { await harness.database.pool.query(`UPDATE goals SET created_at='2020-01-01Z' WHERE id=ANY($1::uuid[])`, [parents.map((item) => item.goal.id)]); });
    const query = new URLSearchParams({ domain_key: "projects", status: "active", limit: "2" });
    const first = await page(query);
    expect(first.items).toHaveLength(2); expect(first.nextCursor).toBeTruthy();
    const last = await page(new URLSearchParams({ ...Object.fromEntries(query), cursor: first.nextCursor! }));
    expect(last.items).toHaveLength(1); expect(last.nextCursor).toBeNull();
    const all = [...first.items, ...last.items];
    expect(all.map((item) => item.goal.id)).toEqual(parents.map((item) => item.goal.id).sort().reverse());
    expect(all.find((item) => item.goal.id === parents[0].goal.id)?.progress.provenance?.measurementId).toBe(row.id);
    expect(all.filter((item) => item.goal.id !== parents[0].goal.id).every((item) => item.progress.current === null)).toBe(true);
    expect((await raw("collection", "GET", "", { cookie: owner.cookie, query: new URLSearchParams({ cursor: first.nextCursor!, domain_key: "health", status: "active" }) })).status).toBe(400);
    expect((await page(new URLSearchParams({ domain_key: "projects", status: "archived" }))).items).toEqual([]);
  });

  it("keeps current and count in the same snapshot while another transaction commits a measurement", async () => {
    const parent = await createGoal();
    await createMeasurement(parent.goal.id);
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const pause: LifeosDatabase["transaction"] = (work, config) => harness.database.db.transaction(async (transaction) => {
      // Establish the read snapshot before letting the other client commit; no sleep or mock SQL.
      await transaction.execute("SELECT count(*) FROM goal_measurements");
      locked.resolve(); await release.promise;
      return work(transaction);
    }, config);
    const paused = new Proxy(harness.database.db, { get: (target, key, receiver) => key === "transaction" ? pause : Reflect.get(target, key, receiver) });
    const pending = createGoalsReader(createGoalsReadRepository(paused)).get(owner.actor, parent.goal.id);
    await locked.promise;
    try { await createMeasurement(parent.goal.id, { value: "24000", measured_at: "2020-01-03T00:00:00Z" }); }
    finally { release.resolve(); }
    expect((await pending).progress).toMatchObject({ current: "12000", measurementCount: 1 });
    expect((await get(parent.goal.id)).progress).toMatchObject({ current: "24000", measurementCount: 2 });
  });

  it("rejects invalid units, unsafe values/fields, mixed archive edits and malformed transport without writes", async () => {
    const parent = await createGoal();
    const before = await counts();
    const requests = [
      ...[{ unit: "USD" }, { baseline: "0", target: "0" }, { target: "-1" }, { user_id: other.userId }, { calculation_mode: "computed" }]
        .map((changes) => raw("collection", "POST", "", { cookie: owner.cookie, body: { ...definition, ...changes } })),
      ...[{ value: 1 }, { value: "1.001" }, { unit: "count" }, { user_id: other.userId }, { measured_at: "2020-01-01" }, { measured_at: new Date(Date.now() + 600_000).toISOString() }]
        .map((changes) => raw("measurements", "POST", parent.goal.id, { cookie: owner.cookie, body: { ...measurement, ...changes } })),
      raw("goal", "PATCH", parent.goal.id, { cookie: owner.cookie, body: { title: "Mixed", status: "archived" } }),
      raw("goal", "PATCH", parent.goal.id, { cookie: owner.cookie, body: { baseline: "2" } }),
      raw("collection", "POST", "", { cookie: owner.cookie, body: definition, key: null }),
      raw("collection", "POST", "", { cookie: owner.cookie, body: definition, key: "bad key" }),
      raw("collection", "POST", "", { cookie: owner.cookie, rawBody: "{bad" }),
      raw("collection", "POST", "", { cookie: owner.cookie, body: definition, headers: { "content-type": "text/plain" } }),
      raw("measurement", "DELETE", randomUUID(), { cookie: owner.cookie, body: {} }),
    ];
    for (const response of await Promise.all(requests)) {
      expect(response.status).toBe(400); expect(apiFailureSchema.parse(await response.json()).errors[0]?.code).toBe("VALIDATION_ERROR");
    }
    for (const query of [new URLSearchParams({ limit: "101" }), new URLSearchParams({ cursor: "invalid" }), new URLSearchParams({ user_id: owner.userId }), new URLSearchParams("limit=1&limit=2")]) {
      expect((await raw("collection", "GET", "", { cookie: owner.cookie, query })).status).toBe(400);
      expect((await raw("measurements", "GET", parent.goal.id, { cookie: owner.cookie, query })).status).toBe(400);
    }
    expect(await counts()).toEqual(before);
  });

  it("refuses a body user id on goal and measurement edits instead of using it as the actor (LFS-209)", async () => {
    const parent = await createGoal();
    const row = await createMeasurement(parent.goal.id);
    const before = await counts();
    const forgeries = [{ user_id: other.userId }, { userId: other.userId }, { user_id: owner.userId }];
    const requests = [owner, other].flatMap((actor) => forgeries.flatMap((forged) => [
      raw("goal", "PATCH", parent.goal.id, { cookie: actor.cookie, body: { title: "Forged", ...forged } }),
      raw("goal", "PATCH", parent.goal.id, { cookie: actor.cookie, body: { status: "archived", ...forged } }),
      raw("measurement", "PATCH", row.id, { cookie: actor.cookie, body: { value: "1", ...forged } }),
    ]));
    for (const response of await Promise.all(requests)) {
      expect(response.status).toBe(400); expect(apiFailureSchema.parse(await response.json()).errors[0]?.code).toBe("VALIDATION_ERROR");
    }
    expect(await counts()).toEqual(before);
    expect(await get(parent.goal.id)).toMatchObject({ goal: { title: definition.title, status: "active", user_id: owner.userId }, progress: { current: measurement.value } });
    expect((await history(parent.goal.id, new URLSearchParams())).items).toMatchObject([{ id: row.id, value: measurement.value, user_id: owner.userId }]);
  });

  it("rolls back HTTP writes on receipt failure, returns a safe 500 and leaves keys retryable", async () => {
    const parent = await createGoal();
    const row = await createMeasurement(parent.goal.id);
    const before = await counts();
    const key = randomUUID();
    const namespace = `"${harness.schemaName}"`;
    await databaseOperation(async () => {
      await harness.database.pool.query(`CREATE FUNCTION ${namespace}.reject_api_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private_sql secret-password' USING ERRCODE='23514'; END $$`);
      await harness.database.pool.query(`CREATE TRIGGER reject_api AFTER INSERT ON ${namespace}.goal_command_receipts FOR EACH ROW EXECUTE FUNCTION ${namespace}.reject_api_receipt()`);
    });
    try {
      for (const response of [await raw("collection", "POST", "", { cookie: owner.cookie, body: definition, key }),
        await raw("goal", "PATCH", parent.goal.id, { cookie: owner.cookie, body: { title: "Must rollback" } }),
        await raw("measurements", "POST", parent.goal.id, { cookie: owner.cookie, body: measurement }),
        await raw("measurement", "PATCH", row.id, { cookie: owner.cookie, body: { value: "3" } }),
        await raw("measurement", "DELETE", row.id, { cookie: owner.cookie })]) {
        expect(response.status).toBe(500);
        expect(apiFailureSchema.parse(await response.json()).errors).toEqual([{ code: "INTERNAL_ERROR", message: "Internal server error." }]);
      }
      expect(await counts()).toEqual(before);
      expect((await get(parent.goal.id)).progress.current).toBe(measurement.value);
    } finally {
      await databaseOperation(async () => { await harness.database.pool.query(`DROP TRIGGER reject_api ON ${namespace}.goal_command_receipts`); await harness.database.pool.query(`DROP FUNCTION ${namespace}.reject_api_receipt()`); });
    }
    await createGoal({}, key);
    expect(await counts()).toEqual({ ...before, goals: before.goals + 1, events: before.events + 1, receipts: before.receipts + 1 });
  });

  it("returns no-store envelopes and fresh request ids while logs contain only technical metadata", async () => {
    const id = randomUUID();
    const response = await raw("collection", "GET", "", { cookie: owner.cookie, headers: { "x-correlation-id": id, "x-request-id": id, "x-user-id": other.userId } });
    const body = goalsPageResponseSchema.parse(await response.json());
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe(body.meta.request_id);
    expect(body.meta.request_id).not.toBe(id); expect(body.meta.correlation_id).toBe(id);
    expect(logs.at(-1)).toMatchObject({ event: "http.request", status: 200, ...body.meta });
    for (const event of logs) expect(Object.keys(event).sort()).toEqual(["code", "correlation_id", "event", "request_id", "status"]);
    const output = JSON.stringify(logs);
    for (const secret of [owner.userId, other.userId, owner.email, owner.password, owner.sessionToken, definition.title, measurement.note, "private_sql", "secret-password"]) expect(output).not.toContain(secret);
  });
});
