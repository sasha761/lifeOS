import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { goalSchema } from "@lifeos/contracts";
import type { Goal } from "@lifeos/contracts";
import { actorFromVerifiedSession, ConflictError, createGoalsService, InvalidInputError, NotFoundError } from "../src/index.ts";
import type { Actor, GoalsRepository, GoalsUnitOfWork } from "../src/index.ts";

const owner = actorFromVerifiedSession("owner");
const other = actorFromVerifiedSession("other");
const input = { domain_key: "finance", title: "Save", unit: "NOK", baseline: "0", target: "50000", direction: "increase" };

function memory() {
  const rows = new Map<string, Goal>();
  const repository: GoalsRepository = {
    deleteGoal: vi.fn<GoalsRepository["deleteGoal"]>(async (actor, id) => {
      const goal = rows.get(id);
      if (!goal || goal.user_id !== actor.userId) return null;
      rows.delete(id); return goal;
    }),
    create: vi.fn<GoalsRepository["create"]>(async (actor, data) => {
      const goal = goalSchema.parse({ ...data, id: randomUUID(), user_id: actor.userId, status: "active", created_at: "2026-11-15T10:00:00Z", updated_at: "2026-11-15T10:00:00Z" });
      rows.set(goal.id, goal);
      return { ...goal };
    }),
    find: vi.fn<GoalsRepository["find"]>(async (actor, id) => {
      const row = rows.get(id);
      if (!row || row.user_id !== actor.userId) return null;
      return { ...row };
    }),
    updateActive: vi.fn<GoalsRepository["updateActive"]>(async (actor, id, changes) => {
      const row = rows.get(id);
      if (!row || row.user_id !== actor.userId || row.status !== "active") return null;
      const updated = { ...row, ...changes, updated_at: "2026-11-15T10:00:01.000Z" };
      rows.set(id, updated);
      return { ...updated };
    }),
    archive: vi.fn<GoalsRepository["archive"]>(async (actor, id) => {
      const row = rows.get(id);
      if (!row || row.user_id !== actor.userId) return null;
      if (row.status === "archived") return { ...row };
      const archived: Goal = { ...row, status: "archived", updated_at: "2026-11-15T10:00:02.000Z" };
      rows.set(id, archived);
      return { ...archived };
    }),
  };
  const events = { append: vi.fn(async () => {}) };
  const unit: GoalsUnitOfWork = { goals: repository,
    runDeletion: async (_actor, _command, operation) => ({ kind: "success", result: await operation(repository) }),
    run: async (_actor, _command, operation) => ({ kind: "success", goal: await operation({ goals: repository, events }) }) };
  const audited = createGoalsService(unit);
  const options = { idempotencyKey: "unit-key", source: "web" };
  const service = {
    get: audited.get,
    create: (actor: Actor, input: unknown) => audited.create(actor, input, options),
    update: (actor: Actor, id: unknown, input: unknown) => audited.update(actor, id, input, options),
    archive: (actor: Actor, id: unknown) => audited.archive(actor, id, options),
  };
  return { rows, repository, service, audited, events, unit };
}

describe("goals service", () => {
  it.each([false, true])("deletes an owned goal (archived=%s) without appending history", async (archived) => {
    const { audited, events } = memory();
    const options = { idempotencyKey: "delete-key", source: "web" };
    const goal = await audited.create(owner, input, options);
    if (archived) await audited.archive(owner, goal.id, options);
    events.append.mockClear();
    await expect(audited.deleteGoal(other, goal.id, options)).rejects.toBeInstanceOf(NotFoundError);
    await expect(audited.deleteGoal(owner, "invalid", options)).rejects.toBeInstanceOf(NotFoundError);
    await expect(audited.deleteGoal(owner, goal.id, {})).rejects.toBeInstanceOf(InvalidInputError);
    expect(await audited.deleteGoal(owner, goal.id.toUpperCase(), options)).toEqual({ id: goal.id, user_id: owner.userId, deleted: true });
    await expect(audited.get(owner, goal.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(events.append).not.toHaveBeenCalled();
  });
  it("creates the actor's manual goal with exact strings, then edits metadata only", async () => {
    const { service } = memory();
    const created = await service.create(owner, { ...input, baseline: "9007199254740993.01", target: "9007199254740993.02" });
    expect(created).toMatchObject({ user_id: "owner", calculation_mode: "manual", status: "active", baseline: "9007199254740993.01" });
    const updated = await service.update(owner, created.id, { title: " Renamed ", due_at: "2026-12-01T00:00:00+01:00" });
    expect(updated).toMatchObject({ title: "Renamed", due_at: "2026-11-30T23:00:00.000Z", baseline: created.baseline, target: created.target, direction: created.direction });
    expect(await service.get(owner, created.id)).toEqual(updated);
    expect(updated).not.toHaveProperty("userId");
  });
  it.each([{ calculation_mode: "computed" }, { target: "0" }, { baseline: 0 }, { user_id: "other" }, { status: "archived" }])(
    "rejects unsafe creation %j before persistence", async (changes) => {
      const { service, repository } = memory();
      await expect(service.create(owner, { ...input, ...changes })).rejects.toBeInstanceOf(InvalidInputError);
      expect(repository.create).not.toHaveBeenCalled();
    },
  );
  it.each([{ baseline: "1" }, { target: "2" }, { direction: "decrease" }, { unit: "count" }, { domain_key: "work" }, { user_id: "other" }])(
    "keeps measurement definitions immutable %j", async (changes) => {
      const { service, repository } = memory();
      const goal = await service.create(owner, input);
      await expect(service.update(owner, goal.id, changes)).rejects.toBeInstanceOf(InvalidInputError);
      expect(repository.updateActive).not.toHaveBeenCalled();
      expect(await service.get(owner, goal.id)).toEqual(goal);
    },
  );
  it("makes foreign and missing resources indistinguishable for every operation", async () => {
    const { service } = memory();
    const goal = await service.create(owner, input);
    for (const id of [goal.id, randomUUID(), "invalid-id"]) {
      await expect(service.get(other, id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.update(other, id, { title: "Forged" })).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.archive(other, id)).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(await service.get(owner, goal.id)).toEqual(goal);
  });
  it("archives once, preserves the row, and rejects subsequent edits with CONFLICT", async () => {
    const { service, repository } = memory();
    const created = await service.create(owner, input);
    const archived = await service.archive(owner, created.id);
    expect(archived.status).toBe("archived");
    expect(await service.archive(owner, created.id)).toEqual(archived);
    expect(await service.get(owner, created.id)).toEqual(archived);
    await expect(service.update(owner, created.id, { title: "Changed" })).rejects.toMatchObject({ code: "CONFLICT", message: "Resource conflict." });
    expect(repository.updateActive).not.toHaveBeenCalled();
  });
  it("does not update a goal archived between its lookup and the conditional write", async () => {
    const { service, repository } = memory();
    const goal = await service.create(owner, input);
    vi.mocked(repository.updateActive).mockResolvedValueOnce(null);
    await expect(service.update(owner, goal.id, { title: "Raced" })).rejects.toBeInstanceOf(ConflictError);
  });
  it("also rejects foreign rows returned by a broken persistence adapter", async () => {
    const { repository, service } = memory();
    const goal = await service.create(owner, input);
    vi.mocked(repository.find).mockResolvedValue(goal);
    await expect(service.get(other, goal.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.update(other, goal.id, { title: "Forged" })).rejects.toBeInstanceOf(NotFoundError);
    expect(repository.updateActive).not.toHaveBeenCalled();
  });
});

describe("audited goal commands", () => {
  it("emits minimal snapshots for create/update/archive without free text or owner identity", async () => {
    const { service, events } = memory();
    const goal = await service.create(owner, { ...input, title: "private title", description: "private note" });
    await service.update(owner, goal.id, { title: "other private title", due_at: "2026-12-01T00:00:00Z" });
    await service.archive(owner, goal.id);
    expect(events.append).toHaveBeenCalledTimes(3);
    const emitted = vi.mocked(events.append).mock.calls;
    expect(JSON.stringify(emitted)).not.toContain("private");
    expect(JSON.stringify(emitted)).not.toContain('"user_id"');
    expect(emitted[0]).toMatchObject([{ event_type: "goal.created", payload: { before: null, after: { status: "active" } } }]);
    expect(emitted[1]).toMatchObject([{ event_type: "goal.updated", payload: { changed_fields: ["title", "due_at"], before: { due_at: null }, after: { due_at: "2026-12-01T00:00:00.000Z" } } }]);
    expect(emitted[2]).toMatchObject([{ event_type: "goal.archived", payload: { before: { status: "active" }, after: { status: "archived" } } }]);
  });
  it("does not invent events for no-op edits or repeated archives", async () => {
    const { service, events, repository } = memory();
    const goal = await service.create(owner, input);
    events.append.mockClear();
    expect(await service.update(owner, goal.id, { title: goal.title })).toEqual(goal);
    expect(repository.updateActive).not.toHaveBeenCalled();
    expect(events.append).not.toHaveBeenCalled();
    await service.archive(owner, goal.id);
    await service.archive(owner, goal.id);
    expect(events.append).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, {}, { idempotencyKey: "bad\n", source: "web" }, { idempotencyKey: "key", source: "telegram" }])(
    "rejects invalid context before persistence %j", async (options) => {
      const { audited, repository } = memory();
      await expect(audited.create(owner, input, options)).rejects.toBeInstanceOf(InvalidInputError);
      expect(repository.create).not.toHaveBeenCalled();
    },
  );
  it("maps durable receipt conflicts and missing replay resources to safe domain errors", async () => {
    const { audited, unit } = memory();
    const options = { idempotencyKey: "key", source: "web" };
    unit.run = async () => ({ kind: "conflict" });
    await expect(audited.create(owner, input, options)).rejects.toBeInstanceOf(ConflictError);
    unit.run = async () => ({ kind: "not_found" });
    await expect(audited.create(owner, input, options)).rejects.toBeInstanceOf(NotFoundError);
  });
});
