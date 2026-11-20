import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGoalInputSchema, DOMAIN_KEYS } from "@lifeos/contracts";
import { createGoalsRepository, createGoalsUnitOfWork } from "@lifeos/db";
import { ConflictError, createGoalsService, InvalidInputError, NotFoundError } from "@lifeos/domain";
import type { Actor, GoalsRepository, GoalsService } from "@lifeos/domain";
import { createAuthHarness, databaseOperation } from "./support/auth-harness.ts";
import type { AuthHarness, TestUser } from "./support/auth-harness.ts";
import { expectDomainOwnership } from "./support/ownership-contract.ts";

let harness: AuthHarness;
let service: ReturnType<typeof withKeys>;
let repository: GoalsRepository;
let owner: TestUser;
let other: TestUser;
const input = { domain_key: "finance", title: "Savings", unit: "NOK", baseline: "0", target: "50000", direction: "increase" };
function withKeys(api: GoalsService) {
  const options = () => ({ idempotencyKey: randomUUID(), source: "web" });
  return { get: api.get,
    create: (actor: Actor, input: unknown) => api.create(actor, input, options()),
    update: (actor: Actor, id: unknown, input: unknown) => api.update(actor, id, input, options()),
    archive: (actor: Actor, id: unknown) => api.archive(actor, id, options()),
  };
}

beforeAll(async () => {
  harness = await createAuthHarness({ suite: "lfs205_goals", users: ["owner", "other"] });
  owner = await harness.signUp("owner");
  other = await harness.signUp("other");
  repository = createGoalsRepository(harness.database.db);
  service = withKeys(createGoalsService(createGoalsUnitOfWork(harness.database.db)));
});
afterAll(async () => { await harness?.close(); });

async function snapshot(id: string) {
  return databaseOperation(async () => (await harness.database.pool.query("SELECT * FROM goals WHERE id = $1", [id])).rows[0]);
}

/** Raw SQL deliberately bypasses domain validation, to prove constraints protect the stored state. */
async function rawInsert(changes: Record<string, unknown> = {}): Promise<string> {
  const data = { user_id: owner.userId, ...input, ...changes };
  const entries = Object.entries(data);
  for (const [column] of entries) if (!/^[a-z_]+$/.test(column)) throw new Error("Unsafe test column.");
  return harness.database.pool.query(
    `INSERT INTO goals (${entries.map(([key]) => `"${key}"`).join(", ")}) VALUES (${entries.map((_entry, index) => `$${index + 1}`).join(", ")})`,
    entries.map(([, value]) => value),
  ).then(() => "inserted", (error: unknown) => (error as { code?: string }).code ?? "database-error");
}

describe("persisted goals and ownership", () => {
  it("creates manual goals in all six spheres for the verified actor", async () => {
    for (const domain_key of DOMAIN_KEYS) {
      const goal = await service.create(owner.actor, { ...input, domain_key });
      expect(goal).toMatchObject({ user_id: owner.userId, domain_key, calculation_mode: "manual", metric_key: null, status: "active", unit_label: null });
      expect(goal.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(goal.created_at).toMatch(/Z$/);
      expect(await service.get(owner.actor, goal.id)).toEqual(goal);
    }
  });

  it("reuses the two-user ownership contract for read, edit and archive", async () => {
    const id = await expectDomainOwnership({
      create: async (actor) => (await service.create(actor, input)).id,
      read: (actor, id) => service.get(actor, id),
      update: (actor, id) => service.update(actor, id, { title: "Foreign change" }),
      remove: (actor, id) => service.archive(actor, id),
      snapshot,
    }, { owner, other });
    expect(await repository.find(other.actor, id)).toBeNull();
    expect(await repository.updateActive(other.actor, id, { title: "Direct foreign change" })).toBeNull();
    expect(await repository.archive(other.actor, id)).toBeNull();
    expect((await service.get(owner.actor, id)).title).toBe("Savings");
  });

  it("cannot change ownership, definition or status through metadata input", async () => {
    const goal = await service.create(owner.actor, input);
    const before = await snapshot(goal.id);
    for (const changes of [{ baseline: "1" }, { target: "60000" }, { direction: "decrease" }, { unit: "count" }, { domain_key: "work" }, { user_id: other.userId }, { status: "archived" }]) {
      await expect(service.update(owner.actor, goal.id, changes)).rejects.toBeInstanceOf(InvalidInputError);
    }
    await expect(service.create(owner.actor, { ...input, user_id: other.userId })).rejects.toBeInstanceOf(InvalidInputError);
    expect(await snapshot(goal.id)).toEqual(before);
  });

  it("preserves decimal strings larger than JS safe integers and eight fractional digits", async () => {
    const money = await service.create(owner.actor, { ...input, baseline: "9007199254740993.01", target: "9007199254740993.02" });
    expect(money.baseline).toBe("9007199254740993.01");
    expect(money.target).toBe("9007199254740993.02");
    const tiny = await service.create(owner.actor, { ...input, unit: "custom", unit_label: "km", baseline: "0.00000001", target: "0.00000002" });
    expect((await service.get(owner.actor, tiny.id)).baseline).toBe("0.00000001");
    const difference = await databaseOperation(async () => (await harness.database.pool.query<{ difference: string }>(
      "SELECT (target - baseline)::text AS difference FROM goals WHERE id = $1", [money.id],
    )).rows[0]?.difference);
    expect(difference).toBe("0.01");
    const maximum = await service.create(owner.actor, { ...input, unit: "minutes", target: "9999999999999999999999.99999999" });
    expect((await service.get(owner.actor, maximum.id)).target).toBe("9999999999999999999999.99999999");
  });

  it("supports decrease and all units without conversion or invented progress", async () => {
    const debt = await service.create(owner.actor, { ...input, baseline: "100000", target: "0", direction: "decrease" });
    expect(debt).toMatchObject({ baseline: "100000", target: "0", direction: "decrease" });
    for (const unit of ["count", "minutes", "percent"]) {
      const goal = await service.create(owner.actor, { ...input, unit, target: "100" });
      expect(goal.unit).toBe(unit);
      expect(goal).not.toHaveProperty("current");
      expect(goal).not.toHaveProperty("progressPercent");
    }
  });

  it("reads valid SQL decimals with extra insignificant zeros without rounding or rejection", async () => {
    const id = await databaseOperation(async () => (await harness.database.pool.query<{ id: string }>(
      `INSERT INTO goals (user_id, domain_key, title, unit, baseline, target, direction)
       VALUES ($1, 'finance', 'SQL scale fixture', 'NOK', '0.0000000000', '1.2300000000', 'increase') RETURNING id`, [owner.userId],
    )).rows[0]?.id);
    expect(id).toBeTruthy();
    expect(await service.get(owner.actor, id)).toMatchObject({ baseline: "0", target: "1.23" });
  });

  it("edits metadata, normalizes the deadline to UTC, and clears nullable fields", async () => {
    const goal = await service.create(owner.actor, { ...input, description: "Initial" });
    const updated = await service.update(owner.actor, goal.id, { title: " Updated ", description: "Note", due_at: "2026-12-01T00:30:00+01:00" });
    expect(updated).toMatchObject({ title: "Updated", description: "Note", due_at: "2026-11-30T23:30:00.000Z", created_at: goal.created_at });
    expect(updated.updated_at >= goal.updated_at).toBe(true);
    const cleared = await service.update(owner.actor, goal.id, { description: null, due_at: null });
    expect(cleared).toMatchObject({ description: null, due_at: null, baseline: goal.baseline, target: goal.target, direction: goal.direction });
  });

  it("archives without deletion or a second timestamp update, and blocks further editing", async () => {
    const goal = await service.create(owner.actor, input);
    const archived = await service.archive(owner.actor, goal.id);
    expect(archived.status).toBe("archived");
    expect(await snapshot(goal.id)).toBeTruthy();
    expect(await service.archive(owner.actor, goal.id)).toEqual(archived);
    await expect(service.update(owner.actor, goal.id, { title: "Forbidden" })).rejects.toBeInstanceOf(ConflictError);
    expect(await repository.updateActive(owner.actor, goal.id, { title: "Raced edit" })).toBeNull();
    expect(await service.get(owner.actor, goal.id)).toEqual(archived);
  });

  it("returns NOT_FOUND for malformed and missing ids", async () => {
    for (const id of ["not-a-uuid", randomUUID(), null]) {
      await expect(service.get(owner.actor, id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.update(owner.actor, id, { title: "Missing" })).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.archive(owner.actor, id)).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it("can bind the repository to a Drizzle transaction and rolls back a failed creation", async () => {
    const count = async () => databaseOperation(async () => (await harness.database.pool.query<{ count: number }>("SELECT count(*)::int AS count FROM goals")).rows[0]?.count);
    const before = await count();
    const aborted = new Error("Deliberate transaction rollback.");
    await expect(harness.database.db.transaction(async (transaction) => {
      await createGoalsRepository(transaction).create(owner.actor, createGoalInputSchema.parse(input));
      throw aborted;
    })).rejects.toBe(aborted);
    expect(await count()).toBe(before);
  });
});

describe("goals database constraints", () => {
  it.each([
    ["a missing owner", { user_id: null }, "23502"],
    ["an unknown owner", { user_id: "missing" }, "23503"],
    ["a seventh sphere", { domain_key: "seventh" }, "23514"],
    ["a computed goal", { calculation_mode: "computed" }, "23514"],
    ["a manual metric provider", { metric_key: "balance" }, "23514"],
    ["an unsupported status", { status: "completed" }, "23514"],
    ["an unsupported unit", { unit: "EUR" }, "23514"],
    ["a missing custom label", { unit: "custom" }, "23514"],
    ["a label on NOK", { unit_label: "km" }, "23514"],
    ["a blank title", { title: " " }, "23514"],
    ["a long title", { title: "x".repeat(201) }, "23514"],
    ["a long description", { description: "x".repeat(4001) }, "23514"],
    ["negative values", { baseline: "-1" }, "23514"],
    ["equal values", { target: "0" }, "23514"],
    ["a reversed direction", { direction: "decrease" }, "23514"],
    ["an unknown direction", { direction: "sideways" }, "23514"],
    ["NaN", { target: "NaN" }, "23514"],
    ["Infinity", { target: "Infinity" }, "23514"],
    ["an overflowing integer", { target: "10000000000000000000000" }, "23514"],
    ["excess decimal precision", { baseline: "0.000000001" }, "23514"],
    ["fractional ore", { baseline: "0.001" }, "23514"],
    ["fractional count", { unit: "count", baseline: "0.1" }, "23514"],
    ["percent above 100", { unit: "percent", target: "100.00000001" }, "23514"],
    ["an infinite deadline", { due_at: "infinity" }, "23514"],
    ["an infinite creation timestamp", { created_at: "infinity" }, "23514"],
  ] as const)("reject %s even when validation is bypassed", async (_name, changes, code) => {
    expect(await rawInsert(changes)).toBe(code);
  });
  it("cascade-deletes goals only with the owning user", async () => {
    const userId = `cascade-${randomUUID()}`;
    const retained = await service.create(owner.actor, input);
    await databaseOperation(async () => {
      await harness.database.pool.query(`INSERT INTO "user" (id, name, email) VALUES ($1, 'Cascade fixture', $2)`, [userId, `${userId}@example.test`]);
    });
    expect(await rawInsert({ user_id: userId })).toBe("inserted");
    const remaining = await databaseOperation(async () => {
      await harness.database.pool.query(`DELETE FROM "user" WHERE id = $1`, [userId]);
      return (await harness.database.pool.query<{ count: number }>("SELECT count(*)::int AS count FROM goals WHERE user_id = $1", [userId])).rows[0]?.count;
    });
    expect(remaining).toBe(0);
    expect(await service.get(owner.actor, retained.id)).toEqual(retained);
  });
});
