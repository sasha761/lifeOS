import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiFailureSchema, goalDeletionResponseSchema } from "@lifeos/contracts";
import { createGoalsReadRepository, createGoalsUnitOfWork, createGoalMeasurementsUnitOfWork } from "@lifeos/db";
import { ConflictError, createGoalsReader, createGoalsService, createGoalMeasurementsService, NotFoundError } from "@lifeos/domain";
import type { GoalsUnitOfWork } from "@lifeos/domain";
import { createGoalsRoutes } from "../../server/goals.ts";
import { createAuthHarness, TEST_ORIGIN } from "./support/auth-harness.ts";
import type { AuthHarness, TestUser } from "./support/auth-harness.ts";

let harness: AuthHarness;
let owner: TestUser;
let other: TestUser;
const options = (idempotencyKey = randomUUID()) => ({ idempotencyKey, source: "web" as const });
const input = { domain_key: "projects", title: "Disposable private goal", unit: "count", baseline: "0", target: "5", direction: "increase" };
const reading = { value: "2", measured_at: "2020-01-01T00:00:00Z" };
const unit = () => createGoalsUnitOfWork(harness.database.db);
const service = () => createGoalsService(unit());
const measurements = () => createGoalMeasurementsService(createGoalMeasurementsUnitOfWork(harness.database.db));
beforeAll(async () => {
  harness = await createAuthHarness({ suite: "lfs216_delete", users: ["owner", "other"] });
  owner = await harness.signUp("owner"); other = await harness.signUp("other");
});
afterAll(async () => { await harness?.close(); });

async function snapshot(id: string) {
  return (await harness.database.pool.query<{ goals: number; measurements: number; events: number; receipts: number }>(`SELECT
    (SELECT count(*)::int FROM goals WHERE id=$1) AS goals,
    (SELECT count(*)::int FROM goal_measurements WHERE goal_id=$1) AS measurements,
    (SELECT count(*)::int FROM activity_events WHERE goal_id=$1) AS events,
    (SELECT count(*)::int FROM goal_command_receipts WHERE goal_id=$1) AS receipts`, [id])).rows[0]!;
}
function remove(id: string, { cookie = owner.cookie, key = randomUUID(), body, origin, requestOrigin = TEST_ORIGIN }: { cookie?: string; key?: string; body?: string; origin?: string; requestOrigin?: string } = {}) {
  const routes = createGoalsRoutes({ resolveAuth: () => harness.auth, resolveGoals: service, resolveMeasurements: measurements,
    resolveReader: () => createGoalsReader(createGoalsReadRepository(harness.database.db)), log: () => {} });
  return routes.goal.DELETE(new Request(`${requestOrigin}/api/v1/goals/${id}`, { method: "DELETE", body,
    headers: { cookie, "idempotency-key": key, ...(origin === undefined ? {} : { origin }) } }), { params: Promise.resolve({ goalId: id }) });
}

describe("LFS-216 permanent goal deletion on PostgreSQL", () => {
  it.each([false, true])("cascades all dependent rows, protects other users and replays after service recreation (archived=%s)", async (archived) => {
    const goal = await service().create(owner.actor, input, options());
    await measurements().create(owner.actor, goal.id, reading, options());
    if (archived) await service().archive(owner.actor, goal.id, options());
    const retained = await service().create(other.actor, input, options());
    await measurements().create(other.actor, retained.id, reading, options());
    const before = await snapshot(goal.id);
    const otherBefore = await snapshot(retained.id);
    expect(before).toMatchObject({ goals: 1, measurements: 1 });
    expect(before.events).toBeGreaterThan(0); expect(before.receipts).toBeGreaterThan(0);
    await expect(service().deleteGoal(other.actor, goal.id, options())).rejects.toBeInstanceOf(NotFoundError);
    expect(await snapshot(goal.id)).toEqual(before);
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 4 }, () => remove(goal.id, { key, origin: TEST_ORIGIN })));
    for (const response of results) {
      expect(response.status).toBe(200);
      expect(goalDeletionResponseSchema.parse(await response.json()).data).toEqual({ id: goal.id, user_id: owner.userId, deleted: true });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(await service().deleteGoal(owner.actor, goal.id.toUpperCase(), options(key))).toMatchObject({ id: goal.id, deleted: true });
    expect(await snapshot(goal.id)).toEqual({ goals: 0, measurements: 0, events: 0, receipts: 0 });
    expect(await snapshot(retained.id)).toEqual(otherBefore);
    expect((await remove(goal.id)).status).toBe(404);
    expect((await remove(goal.id, { cookie: other.cookie, key })).status).toBe(404);
    for (const id of [randomUUID(), "invalid", retained.id]) expect((await remove(id)).status).toBe(404);
  });

  it("keeps owner/key scope across all operations without retaining goal metadata", async () => {
    const createKey = options();
    const goal = await service().create(owner.actor, input, createKey);
    await expect(service().deleteGoal(owner.actor, goal.id, createKey)).rejects.toBeInstanceOf(ConflictError);
    const context = options();
    await service().deleteGoal(owner.actor, goal.id, context);
    const retained = await service().create(owner.actor, input, options());
    await expect(service().deleteGoal(owner.actor, retained.id, context)).rejects.toBeInstanceOf(ConflictError);
    await expect(service().create(owner.actor, input, context)).rejects.toBeInstanceOf(ConflictError);
    await expect(service().update(owner.actor, retained.id, { title: "changed" }, context)).rejects.toBeInstanceOf(ConflictError);
    await expect(service().archive(owner.actor, retained.id, context)).rejects.toBeInstanceOf(ConflictError);
    await expect(measurements().create(owner.actor, retained.id, reading, context)).rejects.toBeInstanceOf(ConflictError);
    await expect(service().deleteGoal(owner.actor, goal.id, { ...context, source: "manual" })).rejects.toBeInstanceOf(ConflictError);
    const foreign = await service().create(other.actor, input, options());
    await service().deleteGoal(other.actor, foreign.id, context);
    const receipt = (await harness.database.pool.query("SELECT * FROM goal_deletion_receipts WHERE user_id=$1 AND idempotency_key=$2", [owner.userId, context.idempotencyKey])).rows[0] as Record<string, unknown>;
    expect(Object.keys(receipt).sort()).toEqual(["created_at", "idempotency_key", "request_hash", "target_id", "user_id"]);
    expect(JSON.stringify(receipt)).not.toContain(input.title);
  });

  it("rolls back deletion and all cascades if writing the retry proof fails; the same key stays retryable", async () => {
    const goal = await service().create(owner.actor, input, options());
    await measurements().create(owner.actor, goal.id, reading, options());
    const before = await snapshot(goal.id);
    const key = randomUUID();
    await harness.database.pool.query("ALTER TABLE goal_deletion_receipts ADD CONSTRAINT lfs216_failure CHECK (false) NOT VALID");
    try {
      const response = await remove(goal.id, { key });
      expect(response.status).toBe(500);
      expect(apiFailureSchema.parse(await response.json()).errors[0]?.code).toBe("INTERNAL_ERROR");
      expect(await snapshot(goal.id)).toEqual(before);
      expect((await harness.database.pool.query("SELECT 1 FROM goal_deletion_receipts WHERE user_id=$1 AND idempotency_key=$2", [owner.userId, key])).rowCount).toBe(0);
    } finally { await harness.database.pool.query("ALTER TABLE goal_deletion_receipts DROP CONSTRAINT lfs216_failure"); }
    expect((await remove(goal.id, { key })).status).toBe(200);
    expect(await snapshot(goal.id)).toEqual({ goals: 0, measurements: 0, events: 0, receipts: 0 });
  });

  it.each(["delete", "measurement"] as const)("serializes a parallel measurement with deletion, %s holds the parent lock first", async (first) => {
    const goal = await service().create(owner.actor, input, options());
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const goalsUnit = unit();
    const measureUnit = createGoalMeasurementsUnitOfWork(harness.database.db);
    const deleting: GoalsUnitOfWork = { ...goalsUnit, runDeletion: (actor, command, operation) => goalsUnit.runDeletion(actor, command, async (repository) => {
      const pending = repository.find(actor, goal.id);
      if (first === "measurement") started.resolve();
      await pending;
      if (first === "delete") { locked.resolve(); await release.promise; }
      return operation(repository);
    }) };
    const measuring = createGoalMeasurementsService({ ...measureUnit, run: (actor, command, operation) => {
      if (first === "delete") started.resolve();
      return measureUnit.run(actor, command, async (transaction) => {
        if (first === "measurement") { locked.resolve(); await release.promise; }
        return operation(transaction);
      });
    } });
    const erase = () => createGoalsService(deleting).deleteGoal(owner.actor, goal.id, options());
    const add = () => measuring.create(owner.actor, goal.id, reading, options());
    // Observe both rejections immediately, then release the first writer only after the second starts.
    const one = (first === "delete" ? erase() : add()).then((value) => ({ value }), (error: unknown) => ({ error }));
    await locked.promise;
    const two = (first === "delete" ? add() : erase()).then((value) => ({ value }), (error: unknown) => ({ error }));
    try { await started.promise; } finally { release.resolve(); }
    const [a, b] = await Promise.all([one, two]);
    expect(a).toHaveProperty("value");
    if (first === "delete") expect("error" in b && b.error).toBeInstanceOf(NotFoundError);
    else expect(b).toHaveProperty("value");
    expect(await snapshot(goal.id)).toEqual({ goals: 0, measurements: 0, events: 0, receipts: 0 });
  });

  it("rejects guest, body, invalid key and foreign/null Origin without side effects", async () => {
    const goal = await service().create(owner.actor, input, options());
    const before = await snapshot(goal.id);
    expect((await remove("invalid", { cookie: "", key: "", body: "bad", origin: "https://foreign.test" })).status).toBe(401);
    for (const body of ["{}", " ", "null"]) expect((await remove(goal.id, { body })).status).toBe(400);
    expect((await remove(goal.id, { key: "" })).status).toBe(400);
    for (const origin of ["https://foreign.test", "null", `${TEST_ORIGIN}.evil.test`]) expect((await remove(goal.id, { origin })).status).toBe(403);
    expect(await snapshot(goal.id)).toEqual(before);
    expect((await remove(goal.id, { body: "", origin: TEST_ORIGIN, requestOrigin: "http://internal-next:3000" })).status).toBe(200);
  });
});
