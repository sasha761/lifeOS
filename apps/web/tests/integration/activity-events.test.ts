import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createActivityEventsRepository, createActivityEventWriter, createGoalsUnitOfWork } from "@lifeos/db";
import { ConflictError, createGoalsService, goalAuditSnapshot, InvalidInputError, NotFoundError } from "@lifeos/domain";
import type { GoalsService, GoalsUnitOfWork } from "@lifeos/domain";
import { createAuthHarness, databaseOperation } from "./support/auth-harness.ts";
import type { AuthHarness, TestUser } from "./support/auth-harness.ts";

let harness: AuthHarness;
let service: GoalsService;
let unit: GoalsUnitOfWork;
let owner: TestUser;
let other: TestUser;
const input = { domain_key: "finance", title: "Private goal title", description: "Private goal description", unit: "NOK", baseline: "0", target: "50000", direction: "increase" };
const options = (idempotencyKey: string = randomUUID(), source: "web" | "manual" = "web") => ({ idempotencyKey, source });

beforeAll(async () => {
  harness = await createAuthHarness({ suite: "lfs210_audit", users: ["owner", "other"] });
  owner = await harness.signUp("owner");
  other = await harness.signUp("other");
  unit = createGoalsUnitOfWork(harness.database.db);
  service = createGoalsService(unit);
});
afterAll(async () => { await harness?.close(); });

const reader = () => createActivityEventsRepository(harness.database.db);
async function counts() {
  return databaseOperation(async () => (await harness.database.pool.query<{ goals: number; events: number; receipts: number }>(
    `SELECT (SELECT count(*)::int FROM goals) AS goals, (SELECT count(*)::int FROM activity_events) AS events,
     (SELECT count(*)::int FROM goal_command_receipts) AS receipts`,
  )).rows[0]!);
}
async function withFailure(table: "activity_events" | "goal_command_receipts", work: () => Promise<void>) {
  const namespace = `"${harness.schemaName}"`;
  const functionName = `${namespace}.reject_audit_insert`;
  await databaseOperation(async () => {
    await harness.database.pool.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Deliberate audit failure' USING ERRCODE = '23514'; END $$`);
  });
  try {
    await databaseOperation(async () => { await harness.database.pool.query(`CREATE TRIGGER reject_audit AFTER INSERT ON ${namespace}."${table}" FOR EACH ROW EXECUTE FUNCTION ${functionName}()`); });
    try { await work(); }
    finally { await databaseOperation(async () => { await harness.database.pool.query(`DROP TRIGGER reject_audit ON ${namespace}."${table}"`); }); }
  } finally {
    await databaseOperation(async () => { await harness.database.pool.query(`DROP FUNCTION ${functionName}()`); });
  }
}
async function code(operation: Promise<unknown>) {
  return operation.then(() => "success", (error: unknown) => {
    const failure = error as { code?: string; cause?: { code?: string } };
    return failure.cause?.code ?? failure.code ?? "unknown";
  });
}

describe("transactional goal audit", () => {
  it("commits the goal, minimal before/after events and receipts with correct provenance", async () => {
    const goal = await service.create(owner.actor, input, options());
    await service.update(owner.actor, goal.id, { title: "Changed private title", due_at: "2026-12-01T00:00:00+01:00" }, options());
    await service.archive(owner.actor, goal.id, options(undefined, "manual"));
    const events = await reader().listForGoal(owner.actor, goal.id);
    expect(events).toHaveLength(3);
    expect(new Set(events.map((event) => event.event_type))).toEqual(new Set(["goal.created", "goal.updated", "goal.archived"]));
    const created = events.find((event) => event.event_type === "goal.created")!;
    const updated = events.find((event) => event.event_type === "goal.updated")!;
    const archived = events.find((event) => event.event_type === "goal.archived")!;
    expect(created).toMatchObject({ user_id: owner.userId, domain_key: "finance", source: "web", target_type: "goal", target_id: goal.id, schema_version: 1 });
    expect(created.payload).toMatchObject({ before: null, after: { baseline: "0", target: "50000", status: "active" } });
    expect(updated.payload).toMatchObject({ changed_fields: ["title", "due_at"], before: { due_at: null }, after: { due_at: "2026-11-30T23:00:00.000Z" } });
    expect(archived).toMatchObject({ source: "manual", payload: { before: { status: "active" }, after: { status: "archived" } } });
    const payloads = JSON.stringify(events.map((event) => event.payload));
    for (const secret of [input.title, input.description, "Changed private title", owner.userId, owner.email, owner.password, owner.sessionToken]) expect(payloads).not.toContain(secret);
    for (const event of events) {
      expect(event.occurred_at).toMatch(/Z$/);
      expect(await reader().find(owner.actor, event.id)).toEqual(event);
    }
  });

  it("serializes simultaneous duplicates and replays after recreating the service", async () => {
    const before = await counts();
    const context = options();
    const goals = await Promise.all(Array.from({ length: 6 }, () => service.create(owner.actor, input, context)));
    expect(new Set(goals.map((goal) => goal.id)).size).toBe(1);
    expect(await createGoalsService(createGoalsUnitOfWork(harness.database.db)).create(owner.actor, input, context)).toEqual(goals[0]);
    const after = await counts();
    expect(after).toEqual({ goals: before.goals + 1, events: before.events + 1, receipts: before.receipts + 1 });
  });

  it("fingerprints normalized values rather than JSON key order or equivalent offsets", async () => {
    const context = options();
    const first = await service.create(owner.actor, { ...input, baseline: "0.00", target: "1.23000000", due_at: "2026-12-01T01:00:00+01:00" }, context);
    const replay = await service.create(owner.actor, { direction: "increase", unit: "NOK", title: input.title, description: input.description,
      domain_key: "finance", baseline: "0", target: "1.23", due_at: "2026-12-01T00:00:00Z", calculation_mode: "manual", metric_key: null, unit_label: null }, context);
    expect(replay).toEqual(first);
    expect(await reader().listForGoal(owner.actor, first.id)).toHaveLength(1);
  });

  it("rejects reusing a key for a changed body, operation, source or target", async () => {
    const context = options();
    const first = await service.create(owner.actor, input, context);
    const before = await counts();
    await expect(service.create(owner.actor, { ...input, title: "Changed" }, context)).rejects.toBeInstanceOf(ConflictError);
    await expect(service.create(owner.actor, input, { ...context, source: "manual" })).rejects.toBeInstanceOf(ConflictError);
    await expect(service.archive(owner.actor, first.id, context)).rejects.toBeInstanceOf(ConflictError);
    expect(await counts()).toEqual(before);
    const second = await service.create(owner.actor, input, options());
    const edit = options();
    await service.update(owner.actor, first.id, { title: "Edited" }, edit);
    await expect(service.update(owner.actor, second.id, { title: "Edited" }, edit)).rejects.toBeInstanceOf(ConflictError);
    expect((await service.get(owner.actor, second.id)).title).toBe(input.title);
  });

  it("scopes the same key to separate owners and hides foreign events", async () => {
    const context = options();
    const owned = await service.create(owner.actor, input, context);
    const foreign = await service.create(other.actor, input, context);
    expect(owned.id).not.toBe(foreign.id);
    const [event] = await reader().listForGoal(owner.actor, owned.id);
    expect(await reader().find(other.actor, event.id)).toBeNull();
    expect(await reader().find(other.actor, randomUUID())).toBeNull();
    expect(await reader().find(other.actor, "invalid-id")).toBeNull();
    expect(await reader().listForGoal(other.actor, owned.id)).toEqual([]);
    expect(await reader().listForGoal(owner.actor, foreign.id)).toEqual([]);
    const before = await counts();
    await expect(service.update(other.actor, owned.id, { title: "Foreign edit" }, options())).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.archive(other.actor, owned.id, options())).rejects.toBeInstanceOf(NotFoundError);
    expect(await counts()).toEqual(before);
  });

  it("persists no-op receipts without fake events or timestamp changes; replay returns current state", async () => {
    const before = await counts();
    const goal = await service.create(owner.actor, input, options());
    const noOp = options();
    expect(await service.update(owner.actor, goal.id, { title: goal.title }, noOp)).toEqual(goal);
    await expect(service.update(owner.actor, goal.id, { title: "Different" }, noOp)).rejects.toBeInstanceOf(ConflictError);
    const archived = await service.archive(owner.actor, goal.id, options());
    expect(await service.archive(owner.actor, goal.id, options())).toEqual(archived);
    expect(await service.update(owner.actor, goal.id, { title: goal.title }, noOp)).toEqual(archived);
    expect(await counts()).toEqual({ goals: before.goals + 1, events: before.events + 2, receipts: before.receipts + 4 });
  });

  it("rolls back create, edit and archive when the audit INSERT fails, leaving the key retryable", async () => {
    const goal = await service.create(owner.actor, input, options());
    const before = await counts();
    const retry = options();
    await withFailure("activity_events", async () => {
      expect(await code(service.create(owner.actor, input, retry))).toBe("23514");
      expect(await code(service.update(owner.actor, goal.id, { title: "Must rollback" }, options()))).toBe("23514");
      expect(await code(service.archive(owner.actor, goal.id, options()))).toBe("23514");
      expect(await counts()).toEqual(before);
      expect(await service.get(owner.actor, goal.id)).toEqual(goal);
    });
    const committed = await service.create(owner.actor, input, retry);
    expect(await reader().listForGoal(owner.actor, committed.id)).toHaveLength(1);
  });

  it("rolls back an already inserted event and goal if receipt insertion fails afterward", async () => {
    const before = await counts();
    const retry = options();
    await withFailure("goal_command_receipts", async () => {
      expect(await code(service.create(owner.actor, input, retry))).toBe("23514");
      expect(await counts()).toEqual(before);
    });
    await service.create(owner.actor, input, retry);
    expect(await counts()).toEqual({ goals: before.goals + 1, events: before.events + 1, receipts: before.receipts + 1 });
  });

  it("serializes competing edits so the second before snapshot is the first committed after", async () => {
    const goal = await service.create(owner.actor, input, options());
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const secondStarted = Promise.withResolvers<void>();
    const delayed: GoalsUnitOfWork = { goals: unit.goals, run: (actor, command, operation) => unit.run(actor, command, async (transaction) => {
      await transaction.goals.find(actor, goal.id);
      locked.resolve();
      await release.promise;
      return operation(transaction);
    }) };
    const competing: GoalsUnitOfWork = { goals: unit.goals, run: (actor, command, operation) => unit.run(actor, command, async (transaction) => {
      const pending = transaction.goals.find(actor, goal.id);
      secondStarted.resolve();
      await pending;
      return operation(transaction);
    }) };
    const first = createGoalsService(delayed).update(owner.actor, goal.id, { due_at: "2026-12-01T00:00:00Z" }, options());
    await locked.promise;
    const second = createGoalsService(competing).update(owner.actor, goal.id, { due_at: "2026-12-02T00:00:00Z" }, options());
    try { await secondStarted.promise; } finally { release.resolve(); }
    const [one, two] = await Promise.all([first, second]);
    expect(two.updated_at >= one.updated_at).toBe(true);
    const event = (await reader().listForGoal(owner.actor, goal.id)).find((entry) => entry.event_type === "goal.updated" && entry.payload.after.due_at === two.due_at);
    expect(event?.payload).toMatchObject({ before: { due_at: one.due_at }, after: { due_at: two.due_at } });
  });

  it("rejects invalid context/input before any command writes", async () => {
    const before = await counts();
    for (const context of [undefined, {}, options("bad\nkey"), { idempotencyKey: "key", source: "telegram" }]) {
      await expect(service.create(owner.actor, input, context)).rejects.toBeInstanceOf(InvalidInputError);
    }
    await expect(service.create(owner.actor, { ...input, password: owner.password }, options())).rejects.toBeInstanceOf(InvalidInputError);
    expect(await counts()).toEqual(before);
  });

  it("refuses a foreign or forged event even through the transaction-bound writer", async () => {
    const goal = await service.create(owner.actor, input, options());
    const draft = { goal_id: goal.id, domain_key: goal.domain_key, target_type: "goal" as const, target_id: goal.id,
      schema_version: 1 as const, event_type: "goal.created" as const, payload: { before: null, after: goalAuditSnapshot(goal) } };
    const before = await counts();
    await expect(harness.database.db.transaction((transaction) => createActivityEventWriter(transaction, other.actor, options()).append(draft))).rejects.toThrow("Invalid activity event owner.");
    await expect(harness.database.db.transaction((transaction) => createActivityEventWriter(transaction, owner.actor, options()).append({ ...draft, payload: { ...draft.payload, token: owner.sessionToken } } as unknown as typeof draft))).rejects.toThrow("Invalid activity event.");
    expect(await counts()).toEqual(before);
  });

  it("enforces ownership, uniqueness and payload-key restrictions in PostgreSQL", async () => {
    const context = options();
    const goal = await service.create(owner.actor, input, context);
    const payload = { before: null, after: goalAuditSnapshot(goal) };
    const insert = (changes: Record<string, unknown>) => {
      const data = { user_id: owner.userId, domain_key: "finance", goal_id: goal.id, event_type: "goal.created", source: "web", target_type: "goal", target_id: goal.id, idempotency_key: randomUUID(), schema_version: 1, payload, ...changes };
      const entries = Object.entries(data);
      return code(harness.database.pool.query(`INSERT INTO activity_events (${entries.map(([key]) => `"${key}"`).join(",")}) VALUES (${entries.map((_entry, index) => `$${index + 1}`).join(",")})`, entries.map(([, value]) => value)));
    };
    for (const [changes, expected] of [
      [{ user_id: null }, "23502"], [{ user_id: other.userId }, "23503"], [{ domain_key: "work" }, "23503"],
      [{ goal_id: randomUUID(), target_id: randomUUID() }, "23514"], [{ event_type: "unknown" }, "23514"],
      [{ source: "unknown" }, "23514"], [{ schema_version: 2 }, "23514"], [{ idempotency_key: "bad\n" }, "23514"],
      [{ idempotency_key: context.idempotencyKey }, "23505"], [{ payload: { ...payload, password: "secret" } }, "23514"],
      [{ payload: { before: null, after: { ...goalAuditSnapshot(goal), token: "secret" } } }, "23514"], [{ payload: [] }, "23514"],
    ] as const) expect(await insert(changes)).toBe(expected);
    expect(await code(harness.database.pool.query(`INSERT INTO goal_command_receipts (user_id,idempotency_key,request_hash,operation,source,goal_id,domain_key)
      VALUES ($1,$2,$3,'create','web',$4,'finance')`, [other.userId, randomUUID(), "a".repeat(64), goal.id]))).toBe("23503");
  });
});
