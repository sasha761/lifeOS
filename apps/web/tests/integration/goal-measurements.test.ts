import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createActivityEventsRepository, createGoalMeasurementsUnitOfWork, createGoalsUnitOfWork } from "@lifeos/db";
import { ConflictError, createGoalMeasurementsService, createGoalsService, InvalidInputError, NotFoundError } from "@lifeos/domain";
import type { GoalMeasurementsService, GoalMeasurementsUnitOfWork, GoalsService, GoalsUnitOfWork } from "@lifeos/domain";
import { createAuthHarness, databaseOperation } from "./support/auth-harness.ts";
import type { AuthHarness, TestUser } from "./support/auth-harness.ts";
import { expectDomainOwnership } from "./support/ownership-contract.ts";

let harness: AuthHarness;
let owner: TestUser;
let other: TestUser;
let goals: GoalsService;
let service: GoalMeasurementsService;
let unit: GoalMeasurementsUnitOfWork;
const definition = { domain_key: "finance", title: "Private goal", unit: "NOK", baseline: "10", target: "50000", direction: "increase" };
const input = { value: "9007199254740993.01", measured_at: "2020-01-02T00:00:00Z", note: "Private measurement note" };
const options = (idempotencyKey: string = randomUUID(), source: "web" | "manual" = "web") => ({ idempotencyKey, source });
beforeAll(async () => {
  harness = await createAuthHarness({ suite: "lfs206_measurements", users: ["owner", "other"] });
  owner = await harness.signUp("owner"); other = await harness.signUp("other");
  goals = createGoalsService(createGoalsUnitOfWork(harness.database.db));
  unit = createGoalMeasurementsUnitOfWork(harness.database.db);
  service = createGoalMeasurementsService(unit);
});
afterAll(async () => { await harness?.close(); });
const events = (goalId: string) => createActivityEventsRepository(harness.database.db).listForGoal(owner.actor, goalId);
const goal = () => goals.create(owner.actor, definition, options());
async function counts() {
  return databaseOperation(async () => (await harness.database.pool.query<{ measurements: number; events: number; receipts: number }>(
    `SELECT (SELECT count(*)::int FROM goal_measurements) AS measurements, (SELECT count(*)::int FROM activity_events) AS events,
     (SELECT count(*)::int FROM goal_command_receipts) AS receipts`,
  )).rows[0]!);
}
async function code(operation: Promise<unknown>) {
  return operation.then(() => "success", (error: unknown) => {
    const failure = error as { code?: string; cause?: { code?: string } };
    return failure.cause?.code ?? failure.code ?? "unknown";
  });
}
async function withFailure(table: "activity_events" | "goal_command_receipts", work: () => Promise<void>) {
  const namespace = `"${harness.schemaName}"`;
  const functionName = `${namespace}.reject_measurement_insert`;
  await databaseOperation(async () => {
    await harness.database.pool.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Deliberate measurement failure' USING ERRCODE = '23514'; END $$`);
  });
  try {
    await databaseOperation(async () => { await harness.database.pool.query(`CREATE TRIGGER reject_measurement AFTER INSERT ON ${namespace}."${table}" FOR EACH ROW EXECUTE FUNCTION ${functionName}()`); });
    try { await work(); }
    finally { await databaseOperation(async () => { await harness.database.pool.query(`DROP TRIGGER reject_measurement ON ${namespace}."${table}"`); }); }
  } finally {
    await databaseOperation(async () => { await harness.database.pool.query(`DROP FUNCTION ${functionName}()`); });
  }
}

describe("manual measurements in PostgreSQL", () => {
  it("uses measured time rather than insertion time, preserves exact values and has explicit no-data", async () => {
    const parent = await goal();
    expect(await service.current(owner.actor, parent.id)).toEqual({ goal_id: parent.id, current: null, measurement: null });
    expect(await service.history(owner.actor, parent.id)).toEqual([]);
    const later = await service.create(owner.actor, parent.id, input, options());
    const older = await service.create(owner.actor, parent.id, { ...input, value: "0.01", measured_at: "2020-01-01T00:00:00Z" }, options());
    expect((await service.current(owner.actor, parent.id)).measurement).toEqual(later);
    expect((await service.history(owner.actor, parent.id)).map((row) => row.id)).toEqual([later.id, older.id]);
    const edited = await service.update(owner.actor, older.id, { value: "9007199254740993.02", measured_at: "2020-01-03T01:00:00+01:00" }, options());
    expect((await service.current(owner.actor, parent.id)).measurement).toEqual(edited);
    await service.remove(owner.actor, older.id, options());
    expect((await service.current(owner.actor, parent.id)).current).toBe(input.value);
    await service.remove(owner.actor, later.id, options());
    expect((await service.current(owner.actor, parent.id)).current).toBeNull();
    expect(await service.history(owner.actor, parent.id)).toEqual([]);
    const audit = await events(parent.id);
    expect(audit).toHaveLength(6); // Goal create, two measurements, edit and two deletes.
    expect(audit.filter((event) => event.event_type === "goal_measurement.deleted")).toHaveLength(2);
    expect(audit.find((event) => event.event_type === "goal_measurement.updated")?.payload).toMatchObject({
      before: { value: "0.01" }, after: { value: "9007199254740993.02" }, changed_fields: ["value", "measured_at"],
    });
    for (const secret of [input.note, definition.title, owner.email, owner.password, owner.sessionToken]) expect(JSON.stringify(audit.map((event) => event.payload))).not.toContain(secret);
    expect(audit.find((event) => event.event_type === "goal_measurement.created")).toMatchObject({ source: "web", payload: { after: { source: "manual" } } });
  });

  it("breaks equal measured times by created_at and id, never updated_at", async () => {
    const parent = await goal();
    const first = await service.create(owner.actor, parent.id, input, options());
    const second = await service.create(owner.actor, parent.id, { ...input, value: "2" }, options());
    await databaseOperation(async () => {
      await harness.database.pool.query(`UPDATE goal_measurements SET created_at = CASE WHEN id = $1 THEN '2020-02-02Z'::timestamptz ELSE '2020-02-01Z'::timestamptz END WHERE goal_id = $2`, [first.id, parent.id]);
    });
    expect((await service.current(owner.actor, parent.id)).measurement?.id).toBe(first.id);
    await databaseOperation(async () => { await harness.database.pool.query(`UPDATE goal_measurements SET created_at = '2020-02-01Z' WHERE goal_id = $1`, [parent.id]); });
    const ordered = [first.id, second.id].sort().reverse();
    expect((await service.history(owner.actor, parent.id)).map((row) => row.id)).toEqual(ordered);
    await service.update(owner.actor, ordered[1], { note: "Newest private note" }, options());
    expect((await service.current(owner.actor, parent.id)).measurement?.id).toBe(ordered[0]);
    expect((await events(parent.id)).find((event) => event.event_type === "goal_measurement.updated")?.payload).toMatchObject({ changed_fields: ["note"] });
  });

  it("enforces the reusable two-user contract and the parent ownership boundary", async () => {
    const parent = await goal();
    await expectDomainOwnership({
      create: async (actor) => (await service.create(actor, parent.id, input, options())).id,
      read: service.get, update: (actor, id) => service.update(actor, id, { value: "2" }, options()),
      remove: (actor, id) => service.remove(actor, id, options()),
      snapshot: (id) => databaseOperation(async () => (await harness.database.pool.query(`SELECT * FROM goal_measurements WHERE id = $1`, [id])).rows[0]),
    }, { owner, other });
    const before = await counts();
    for (const id of [parent.id, randomUUID(), "invalid"]) {
      await expect(service.create(other.actor, id, input, options())).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.current(other.actor, id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.history(other.actor, id)).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(await counts()).toEqual(before);
  });

  it("serializes concurrent create, update and delete retries with durable receipts", async () => {
    const parent = await goal();
    const before = await counts();
    const create = options();
    const rows = await Promise.all(Array.from({ length: 6 }, () => service.create(owner.actor, parent.id, input, create)));
    expect(new Set(rows.map((row) => row.id)).size).toBe(1);
    const first = rows[0];
    const update = options();
    const edits = await Promise.all(Array.from({ length: 4 }, () => service.update(owner.actor, first.id, { value: "2.00" }, update)));
    expect(edits.every((row) => row.value === "2")).toBe(true);
    expect(await service.create(owner.actor, parent.id, { ...input, measured_at: "2020-01-02T01:00:00+01:00" }, create)).toEqual(edits[0]);
    const remove = options();
    const deletes = await Promise.all(Array.from({ length: 4 }, () => service.remove(owner.actor, first.id, remove)));
    expect(deletes).toEqual(Array.from({ length: 4 }, () => ({ id: first.id, goal_id: parent.id, user_id: owner.userId, deleted: true })));
    const restarted = createGoalMeasurementsService(createGoalMeasurementsUnitOfWork(harness.database.db));
    expect(await restarted.remove(owner.actor, first.id, remove)).toEqual(deletes[0]);
    await expect(restarted.create(owner.actor, parent.id, input, create)).rejects.toBeInstanceOf(NotFoundError);
    await expect(restarted.update(owner.actor, first.id, { value: "2" }, update)).rejects.toBeInstanceOf(NotFoundError);
    await expect(restarted.remove(owner.actor, first.id, options())).rejects.toBeInstanceOf(NotFoundError);
    expect(await counts()).toEqual({ measurements: before.measurements, events: before.events + 3, receipts: before.receipts + 3 });
  });

  it("shares the user key namespace with goal commands and detects changed bodies/targets/sources", async () => {
    const context = options();
    const parent = await goals.create(owner.actor, definition, context);
    await expect(service.create(owner.actor, parent.id, input, context)).rejects.toBeInstanceOf(ConflictError);
    const create = options();
    const row = await service.create(owner.actor, parent.id, input, create);
    const before = await counts();
    await expect(goals.create(owner.actor, definition, create)).rejects.toBeInstanceOf(ConflictError);
    await expect(service.create(owner.actor, parent.id, { ...input, value: "2" }, create)).rejects.toBeInstanceOf(ConflictError);
    await expect(service.create(owner.actor, parent.id, input, { ...create, source: "manual" })).rejects.toBeInstanceOf(ConflictError);
    await expect(service.update(owner.actor, row.id, { value: "2" }, create)).rejects.toBeInstanceOf(ConflictError);
    await expect(service.remove(owner.actor, row.id, create)).rejects.toBeInstanceOf(ConflictError);
    await expect(service.create(owner.actor, randomUUID(), input, create)).rejects.toBeInstanceOf(ConflictError);
    expect(await counts()).toEqual(before);
    const foreignParent = await goals.create(other.actor, definition, options());
    const foreign = await service.create(other.actor, foreignParent.id, input, create);
    expect(foreign.id).not.toBe(row.id);
  });

  it("keeps no-op timestamps unchanged and reserves their keys without artificial events", async () => {
    const parent = await goal();
    const row = await service.create(owner.actor, parent.id, input, options());
    const before = await counts();
    const context = options();
    expect(await service.update(owner.actor, row.id, { value: "9007199254740993.01000000", note: ` ${input.note} ` }, context)).toEqual(row);
    expect(await counts()).toEqual({ ...before, receipts: before.receipts + 1 });
    await expect(service.update(owner.actor, row.id, { note: null }, context)).rejects.toBeInstanceOf(ConflictError);
    const changed = await service.update(owner.actor, row.id, { note: null }, options());
    expect(changed.created_at).toBe(row.created_at);
    expect(await service.update(owner.actor, row.id, { value: input.value, note: input.note }, context)).toEqual(changed);
  });

  it.each(["activity_events", "goal_command_receipts"] as const)("rolls back create/edit/delete and current when %s insertion fails", async (table) => {
    const parent = await goal();
    const row = await service.create(owner.actor, parent.id, input, options());
    const before = await counts();
    const retry = options();
    await withFailure(table, async () => {
      expect(await code(service.create(owner.actor, parent.id, { ...input, measured_at: "2020-01-03T00:00:00Z" }, retry))).toBe("23514");
      expect(await code(service.update(owner.actor, row.id, { value: "3" }, options()))).toBe("23514");
      expect(await code(service.remove(owner.actor, row.id, options()))).toBe("23514");
      expect(await service.get(owner.actor, row.id)).toEqual(row);
      expect((await service.current(owner.actor, parent.id)).measurement).toEqual(row);
      expect(await counts()).toEqual(before);
    });
    await service.create(owner.actor, parent.id, { ...input, measured_at: "2020-01-03T00:00:00Z" }, retry);
    expect(await counts()).toEqual({ measurements: before.measurements + 1, events: before.events + 1, receipts: before.receipts + 1 });
  });

  it("serializes competing measurement edits with the previous committed before snapshot", async () => {
    const parent = await goal();
    const row = await service.create(owner.actor, parent.id, input, options());
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const delayed: GoalMeasurementsUnitOfWork = { ...unit, run: (actor, command, operation) => unit.run(actor, command, async (transaction) => {
      locked.resolve(); await release.promise; return operation(transaction);
    }) };
    const competing: GoalMeasurementsUnitOfWork = { ...unit, run: (actor, command, operation) => {
      const pending = unit.run(actor, command, operation); started.resolve(); return pending;
    } };
    const first = createGoalMeasurementsService(delayed).update(owner.actor, row.id, { value: "2" }, options());
    await locked.promise;
    const second = createGoalMeasurementsService(competing).update(owner.actor, row.id, { value: "3" }, options());
    try { await started.promise; } finally { release.resolve(); }
    await Promise.all([first, second]);
    expect((await service.current(owner.actor, parent.id)).current).toBe("3");
    expect((await events(parent.id)).find((event) => event.event_type === "goal_measurement.updated" && event.payload.after.value === "3")?.payload)
      .toMatchObject({ before: { value: "2" }, after: { value: "3" } });
  });

  it("makes archived goals read-only and preserves reads and accepted retries", async () => {
    const parent = await goal();
    const create = options();
    const row = await service.create(owner.actor, parent.id, input, create);
    await goals.archive(owner.actor, parent.id, options());
    const before = await counts();
    expect(await service.get(owner.actor, row.id)).toEqual(row);
    expect((await service.history(owner.actor, parent.id))[0]).toEqual(row);
    expect(await service.create(owner.actor, parent.id, input, create)).toEqual(row);
    await expect(service.create(owner.actor, parent.id, input, options())).rejects.toBeInstanceOf(ConflictError);
    await expect(service.update(owner.actor, row.id, { value: "2" }, options())).rejects.toBeInstanceOf(ConflictError);
    await expect(service.remove(owner.actor, row.id, options())).rejects.toBeInstanceOf(ConflictError);
    expect(await counts()).toEqual(before);
  });

  it("coordinates goal archive with a pending measurement using the same parent lock", async () => {
    const parent = await goal();
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const delayed: GoalMeasurementsUnitOfWork = { ...unit, run: (actor, command, operation) => unit.run(actor, command, async (transaction) => {
      locked.resolve(); await release.promise; return operation(transaction);
    }) };
    const goalUnit = createGoalsUnitOfWork(harness.database.db);
    const competing: GoalsUnitOfWork = { goals: goalUnit.goals, run: (actor, command, operation) => goalUnit.run(actor, command, async (transaction) => {
      const pending = transaction.goals.find(actor, parent.id); started.resolve(); await pending; return operation(transaction);
    }) };
    const pending = createGoalMeasurementsService(delayed).create(owner.actor, parent.id, input, options());
    await locked.promise;
    const archive = createGoalsService(competing).archive(owner.actor, parent.id, options());
    try { await started.promise; } finally { release.resolve(); }
    const [row] = await Promise.all([pending, archive]);
    expect((await service.current(owner.actor, parent.id)).measurement).toEqual(row);
    await expect(service.update(owner.actor, row.id, { note: null }, options())).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects forged fields, invalid units/dates and invalid context before writes", async () => {
    const parent = await goal();
    const before = await counts();
    for (const change of [{ user_id: other.userId }, { goal_id: randomUUID() }, { unit: "count" }, { source: "web" },
      { value: "1.001" }, { value: "-1" }, { note: "x".repeat(1001) }, { measured_at: new Date(Date.now() + 600_000).toISOString() }]) {
      await expect(service.create(owner.actor, parent.id, { ...input, ...change }, options())).rejects.toBeInstanceOf(InvalidInputError);
    }
    for (const context of [undefined, {}, options("bad\nkey"), { idempotencyKey: "key", source: "bank" }]) {
      await expect(service.create(owner.actor, parent.id, input, context)).rejects.toBeInstanceOf(InvalidInputError);
    }
    expect(await counts()).toEqual(before);
  });

  it("enforces exact unit values, time/size limits and owned-parent foreign keys in SQL", async () => {
    const parent = await goal();
    const countGoal = await goals.create(owner.actor, { ...definition, domain_key: "work", unit: "count" }, options());
    const percentGoal = await goals.create(owner.actor, { ...definition, domain_key: "health", unit: "percent", target: "100" }, options());
    const minuteGoal = await goals.create(owner.actor, { ...definition, domain_key: "skills", unit: "minutes" }, options());
    const insert = (changes: Record<string, unknown>) => {
      const entries = Object.entries({ goal_id: parent.id, user_id: owner.userId, unit: "NOK", value: "1.01", measured_at: input.measured_at, ...changes });
      return code(harness.database.pool.query(`INSERT INTO goal_measurements (${entries.map(([key]) => `"${key}"`).join(",")}) VALUES (${entries.map((_entry, index) => `$${index + 1}`).join(",")})`, entries.map(([, value]) => value)));
    };
    for (const changes of [{ value: "-1" }, { value: "NaN" }, { value: "Infinity" }, { value: "10000000000000000000000" }, { value: "1.001" },
      { goal_id: countGoal.id, unit: "count", value: "1.1" }, { goal_id: percentGoal.id, unit: "percent", value: "100.00000001" },
      { goal_id: minuteGoal.id, unit: "minutes", value: "0.000000001" }, { source: "bank" }, { note: " " }, { note: "x".repeat(1001) },
      { measured_at: "infinity" }, { measured_at: "10000-01-01Z" }, { measured_at: new Date(Date.now() + 600_000).toISOString() }]) {
      expect(await insert(changes), JSON.stringify(changes)).toBe("23514");
    }
    for (const changes of [{ user_id: other.userId }, { goal_id: randomUUID() }, { unit: "minutes" }]) expect(await insert(changes)).toBe("23503");
    expect(await insert({ goal_id: minuteGoal.id, unit: "minutes", value: "0.00000001" })).toBe("success");
    expect((await service.current(owner.actor, minuteGoal.id)).current).toBe("0.00000001");
    const indexes = await databaseOperation(async () => harness.database.pool.query<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = 'goal_measurements_current_idx'", [harness.schemaName]));
    expect(indexes.rows[0]?.indexdef).toContain("(user_id, goal_id, measured_at, created_at, id)");
  });
});
