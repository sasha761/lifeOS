import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createGoalInputSchema, goalMeasurementSchema, goalSchema } from "@lifeos/contracts";
import type { Goal, GoalMeasurement } from "@lifeos/contracts";
import { actorFromVerifiedSession, ConflictError, createGoalsService, InvalidInputError, NotFoundError } from "../src/index.ts";
import type { ActivityEventWriter, Actor, GoalsRepository, GoalsUnitOfWork } from "../src/index.ts";

const owner = actorFromVerifiedSession("owner");
const other = actorFromVerifiedSession("other");
const input = { domain_key: "finance", title: "Save", unit: "NOK", baseline: "0", target: "50000", direction: "increase" };

function memory() {
  const rows = new Map<string, Goal>();
  const measured = new Set<string>();
  const repository: GoalsRepository = {
    hasOwnMeasurements: vi.fn<GoalsRepository["hasOwnMeasurements"]>(async (actor, id) => rows.get(id)?.user_id === actor.userId && measured.has(id)),
    claimExample: vi.fn<GoalsRepository["claimExample"]>(async (actor, id) => {
      const row = rows.get(id);
      if (!row || row.user_id !== actor.userId || row.origin !== "starter") return null;
      const claimed: Goal = { ...row, origin: "manual" };
      rows.set(id, claimed); return { ...claimed };
    }),
    deleteGoal: vi.fn<GoalsRepository["deleteGoal"]>(async (actor, id) => {
      const goal = rows.get(id);
      if (!goal || goal.user_id !== actor.userId) return null;
      rows.delete(id); return goal;
    }),
    create: vi.fn<GoalsRepository["create"]>(async (actor, data, options = {}) => {
      const goal = goalSchema.parse({ ...data, id: randomUUID(), user_id: actor.userId, status: "active", origin: options.origin ?? "manual", created_at: "2026-11-15T10:00:00Z", updated_at: "2026-11-15T10:00:00Z" });
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
      const updated = goalSchema.parse({ ...row, ...changes, origin: row.origin === "starter" ? "manual" : row.origin, updated_at: "2026-11-15T10:00:01.000Z" });
      rows.set(id, updated);
      return { ...updated };
    }),
    setPhase: vi.fn<GoalsRepository["setPhase"]>(async (actor, id, phase) => {
      const row = rows.get(id);
      if (!row || row.user_id !== actor.userId || row.status !== "active") return null;
      const updated: Goal = { ...row, phase, phase_changed_at: "2026-11-15T10:00:03.000Z", updated_at: "2026-11-15T10:00:03.000Z" };
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
  const events = { append: vi.fn<ActivityEventWriter["append"]>(async () => {}) };
  // Example measurements of a goal (LFS-218): removed before a redefinition.
  const examples = new Map<string, GoalMeasurement[]>();
  const measurements = { removeExamples: vi.fn(async (_actor: Actor, goalId: string) => { const removed = examples.get(goalId) ?? []; examples.delete(goalId); return removed; }) };
  const unit: GoalsUnitOfWork = { goals: repository,
    runDeletion: async (_actor, _command, operation) => ({ kind: "success", result: await operation(repository) }),
    run: async (_actor, _command, operation) => ({ kind: "success", goal: await operation({ goals: repository, measurements, events }) }) };
  const audited = createGoalsService(unit);
  const options = { idempotencyKey: "unit-key", source: "web" };
  const service = {
    get: audited.get,
    create: (actor: Actor, input: unknown) => audited.create(actor, input, options),
    update: (actor: Actor, id: unknown, input: unknown) => audited.update(actor, id, input, options),
    archive: (actor: Actor, id: unknown) => audited.archive(actor, id, options),
  };
  return { rows, measured, examples, measurements, repository, service, audited, events, unit };
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
    "rejects a partial definition and fields that never change %j", async (changes) => {
      const { service, repository } = memory();
      const goal = await service.create(owner, input);
      await expect(service.update(owner, goal.id, changes)).rejects.toBeInstanceOf(InvalidInputError);
      expect(repository.updateActive).not.toHaveBeenCalled();
      expect(await service.get(owner, goal.id)).toEqual(goal);
    },
  );
  const definition = { unit: "count", unit_label: null, baseline: "2", target: "10", direction: "increase" } as const;
  it("redefines a goal without measurements and records the definition before and after (LFS-217)", async () => {
    const { service, events } = memory();
    const goal = await service.create(owner, input);
    events.append.mockClear();
    const updated = await service.update(owner, goal.id, { ...definition, title: "Read books" });
    expect(updated).toMatchObject({ title: "Read books", unit: "count", unit_label: null, baseline: "2", target: "10", direction: "increase" });
    expect(vi.mocked(events.append).mock.calls[0]).toMatchObject([{ event_type: "goal.updated", payload: {
      changed_fields: ["title", "unit", "baseline", "target"],
      before: { unit: "NOK", baseline: "0", target: "50000" }, after: { unit: "count", baseline: "2", target: "10" } } }]);
  });
  it("rejects a definition change once the goal has a measurement, but still saves metadata with the same definition", async () => {
    const { service, repository, measured } = memory();
    const goal = await service.create(owner, input);
    measured.add(goal.id);
    await expect(service.update(owner, goal.id, { ...definition, title: "Changed" })).rejects.toBeInstanceOf(ConflictError);
    expect(repository.updateActive).not.toHaveBeenCalled();
    expect(await service.get(owner, goal.id)).toEqual(goal);
    vi.mocked(repository.hasOwnMeasurements).mockClear();
    const same = { unit: goal.unit, unit_label: goal.unit_label, baseline: goal.baseline, target: goal.target, direction: goal.direction };
    expect(await service.update(owner, goal.id, { ...same, title: "Renamed" })).toMatchObject({ title: "Renamed", unit: "NOK", target: "50000" });
    expect(repository.hasOwnMeasurements).not.toHaveBeenCalled();
    expect(vi.mocked(repository.updateActive).mock.calls[0]![2]).not.toHaveProperty("unit");
  });
  it.each([{ ...definition, target: "2" }, { ...definition, direction: "decrease" }, { ...definition, unit: "custom" }, { ...definition, unit_label: "km" }, { ...definition, target: "1.5" }])(
    "validates a new definition by the creation rules %j", async (changes) => {
      const { service, repository } = memory();
      const goal = await service.create(owner, input);
      await expect(service.update(owner, goal.id, changes)).rejects.toBeInstanceOf(InvalidInputError);
      expect(repository.updateActive).not.toHaveBeenCalled();
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

describe("example goals become the person's own (LFS-218)", () => {
  const exampleValue = (goalId: string) => goalMeasurementSchema.parse({ id: randomUUID(), goal_id: goalId, user_id: owner.userId, unit: "NOK", value: "1200",
    measured_at: "2026-11-15T10:00:00Z", source: "example", note: "Пример", created_at: "2026-11-15T10:00:00Z", updated_at: "2026-11-15T10:00:00Z" });
  it("names origin in the audit of any real edit, keeps the example values on a metadata edit", async () => {
    const { repository, audited, events, examples, measurements } = memory();
    const goal = await repository.create(owner, createGoalInputSchema.parse(input), { origin: "starter" });
    examples.set(goal.id, [exampleValue(goal.id)]);
    const updated = await audited.update(owner, goal.id, { title: "Моя подушка" }, { idempotencyKey: "edit-1", source: "web" });
    expect(updated.origin).toBe("manual");
    expect(vi.mocked(events.append).mock.calls.at(-1)![0]).toMatchObject({ event_type: "goal.updated", payload: { changed_fields: ["title", "origin"] } });
    expect(measurements.removeExamples).not.toHaveBeenCalled();
    // A no-op is not an edit: the label stays.
    const other = await repository.create(owner, createGoalInputSchema.parse(input), { origin: "starter" });
    expect((await audited.update(owner, other.id, { title: other.title }, { idempotencyKey: "edit-2", source: "web" })).origin).toBe("starter");
  });
  it("removes example values with an audit fact before a redefinition, which own values still forbid", async () => {
    const { repository, audited, events, examples, measured } = memory();
    const goal = await repository.create(owner, createGoalInputSchema.parse(input), { origin: "starter" });
    const removed = exampleValue(goal.id);
    examples.set(goal.id, [removed]);
    vi.mocked(events.append).mockClear();
    const definition = { unit: "count", unit_label: null, baseline: "2", target: "10", direction: "increase" };
    const updated = await audited.update(owner, goal.id, definition, { idempotencyKey: "edit-3", source: "web" });
    expect(updated).toMatchObject({ unit: "count", baseline: "2", origin: "manual" });
    expect(vi.mocked(events.append).mock.calls.map(([event]) => event.event_type)).toEqual(["goal_measurement.deleted", "goal.updated"]);
    expect(vi.mocked(events.append).mock.calls[0]![0]).toMatchObject({ target_id: removed.id, payload: { before: { value: "1200", source: "example" }, after: null } });
    expect(vi.mocked(events.append).mock.calls[1]![0]).toMatchObject({ payload: { changed_fields: ["unit", "baseline", "target", "origin"] } });
    const own = await repository.create(owner, createGoalInputSchema.parse(input));
    measured.add(own.id);
    await expect(audited.update(owner, own.id, definition, { idempotencyKey: "edit-4", source: "web" })).rejects.toBeInstanceOf(ConflictError);
  });
});
