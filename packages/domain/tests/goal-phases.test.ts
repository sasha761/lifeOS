import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { activityEventDraftSchema, goalDetailsSchema, goalMeasurementSchema, goalSchema } from "@lifeos/contracts";
import type { ActivityEvent, Goal } from "@lifeos/contracts";
import {
  actorFromVerifiedSession, ConflictError, createGoalMeasurementsService, createGoalsService, goalDetailsFromRecord, InvalidInputError, NotFoundError,
  toActivityEntry,
} from "../src/index.ts";
import type { ActivityEventWriter, GoalCommand, GoalMeasurementsRepository, GoalsRepository, GoalsUnitOfWork } from "../src/index.ts";

// LFS-225 (ADR-013): goals without measurements, the person's phase and the start date in the domain.
const owner = actorFromVerifiedSession("owner");
const other = actorFromVerifiedSession("other");
const options = { idempotencyKey: "phase-key", source: "web" };
const time = "2026-11-15T10:00:00.000Z";
const unmeasured = { kind: "unmeasured", domain_key: "work", title: "Найти новую работу" };
const numeric = { domain_key: "finance", title: "Save", unit: "NOK", baseline: "0", target: "50000", direction: "increase" };

function memory() {
  const rows = new Map<string, Goal>();
  const commands: GoalCommand[] = [];
  const repository: GoalsRepository = {
    hasOwnMeasurements: vi.fn(async () => false),
    claimExample: vi.fn(async () => null),
    deleteGoal: vi.fn(async () => null),
    create: vi.fn<GoalsRepository["create"]>(async (actor, data) => {
      const goal = goalSchema.parse({ ...data, id: randomUUID(), user_id: actor.userId, status: "active", origin: "manual",
        phase: data.starts_at && data.starts_at > time ? "planned" : "in_progress", created_at: time, updated_at: time });
      rows.set(goal.id, goal);
      return { ...goal };
    }),
    find: vi.fn<GoalsRepository["find"]>(async (actor, id) => { const row = rows.get(id); return row && row.user_id === actor.userId ? { ...row } : null; }),
    updateActive: vi.fn<GoalsRepository["updateActive"]>(async (actor, id, changes) => {
      const row = rows.get(id);
      if (!row || row.user_id !== actor.userId || row.status !== "active") return null;
      const updated = goalSchema.parse({ ...row, ...changes, updated_at: "2026-11-15T10:00:01.000Z" });
      rows.set(id, updated);
      return { ...updated };
    }),
    setPhase: vi.fn<GoalsRepository["setPhase"]>(async (actor, id, phase) => {
      const row = rows.get(id);
      if (!row || row.user_id !== actor.userId || row.status !== "active") return null;
      const updated: Goal = { ...row, phase, phase_changed_at: "2026-11-15T10:00:02.000Z", updated_at: "2026-11-15T10:00:02.000Z" };
      rows.set(id, updated);
      return { ...updated };
    }),
    archive: vi.fn<GoalsRepository["archive"]>(async (actor, id) => {
      const row = rows.get(id);
      if (!row || row.user_id !== actor.userId) return null;
      const archived: Goal = { ...row, status: "archived" };
      rows.set(id, archived);
      return { ...archived };
    }),
  };
  const events = { append: vi.fn<ActivityEventWriter["append"]>(async (event) => { activityEventDraftSchema.parse(event); }) };
  const measurements = { removeExamples: vi.fn(async () => []) };
  const unit: GoalsUnitOfWork = { goals: repository,
    runDeletion: async (_actor, _command, operation) => ({ kind: "success", result: await operation(repository) }),
    run: async (_actor, command, operation) => { commands.push(command); return { kind: "success", goal: await operation({ goals: repository, measurements, events }) }; } };
  return { rows, commands, repository, events, service: createGoalsService(unit) };
}

describe("goal without measurements and phases (LFS-225)", () => {
  it("creates a goal without numbers in progress, or planned when it starts later", async () => {
    const { service, events } = memory();
    const now = await service.create(owner, unmeasured, options);
    expect(now).toMatchObject({ kind: "unmeasured", unit: null, baseline: null, target: null, direction: null, phase: "in_progress", starts_at: null });
    expect(events.append.mock.calls[0]![0]).toMatchObject({ event_type: "goal.created", payload: { after: { kind: "unmeasured", phase: "in_progress", unit: null } } });
    const later = await service.create(owner, { ...unmeasured, starts_at: "2027-01-01T00:00:00+01:00" }, options);
    expect(later).toMatchObject({ phase: "planned", starts_at: "2026-12-31T23:00:00.000Z" });
    await expect(service.create(owner, { ...unmeasured, unit: "NOK" }, options)).rejects.toBeInstanceOf(InvalidInputError);
  });
  it("keeps the LFS-225 defaults out of the creation fingerprint, so an older retry still matches", async () => {
    const { service, commands } = memory();
    await service.create(owner, numeric, options);
    await service.create(owner, { ...numeric, starts_at: "2026-12-01T00:00:00Z" }, options);
    await service.create(owner, unmeasured, options);
    expect(commands[0]!.input).not.toHaveProperty("kind"); expect(commands[0]!.input).not.toHaveProperty("starts_at");
    expect(commands[1]!.input).toMatchObject({ starts_at: "2026-12-01T00:00:00.000Z" });
    expect(commands[2]!.input).toMatchObject({ kind: "unmeasured" });
  });
  it("moves an active goal of either kind between any two phases, one goal.updated each, a repeat changes nothing", async () => {
    const { service, events } = memory();
    for (const input of [unmeasured, numeric]) {
      const goal = await service.create(owner, input, options);
      events.append.mockClear();
      let from = goal.phase;
      for (const phase of ["achieved", "paused", "planned", "in_progress", "achieved", "in_progress"] as const) {
        expect(await service.setPhase(owner, goal.id, { phase }, options)).toMatchObject({ phase, phase_changed_at: "2026-11-15T10:00:02.000Z" });
        expect(events.append.mock.calls.at(-1)![0]).toMatchObject({ event_type: "goal.updated",
          payload: { before: { phase: from }, after: { phase }, changed_fields: ["phase"] } });
        from = phase;
      }
      expect(events.append).toHaveBeenCalledTimes(6);
      expect(await service.setPhase(owner, goal.id, { phase: "in_progress" }, options)).toMatchObject({ phase: "in_progress" });
      expect(events.append).toHaveBeenCalledTimes(6);
    }
  });
  it("rejects a phase change of an archived, foreign or malformed goal and an unknown phase", async () => {
    const { service, repository } = memory();
    const goal = await service.create(owner, unmeasured, options);
    await expect(service.setPhase(owner, goal.id, { phase: "done" }, options)).rejects.toBeInstanceOf(InvalidInputError);
    await expect(service.setPhase(owner, goal.id, { phase: "paused", title: "x" }, options)).rejects.toBeInstanceOf(InvalidInputError);
    await expect(service.setPhase(owner, goal.id, { phase: "paused" }, {})).rejects.toBeInstanceOf(InvalidInputError);
    await expect(service.setPhase(other, goal.id, { phase: "paused" }, options)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.setPhase(owner, "bad", { phase: "paused" }, options)).rejects.toBeInstanceOf(NotFoundError);
    await service.archive(owner, goal.id, options);
    await expect(service.setPhase(owner, goal.id, { phase: "achieved" }, options)).rejects.toBeInstanceOf(ConflictError);
    expect(repository.setPhase).not.toHaveBeenCalled();
  });
  it("edits title, description and dates of a goal without measurements, never a definition", async () => {
    const { service } = memory();
    const goal = await service.create(owner, unmeasured, options);
    const edited = await service.update(owner, goal.id, { title: "Найти работу в Осло", starts_at: "2026-11-01T00:00:00Z", due_at: "2027-03-31T21:59:59.999Z" }, options);
    expect(edited).toMatchObject({ kind: "unmeasured", title: "Найти работу в Осло", starts_at: "2026-11-01T00:00:00.000Z" });
    const definition = { unit: "NOK", unit_label: null, baseline: "0", target: "10", direction: "increase" };
    await expect(service.update(owner, goal.id, definition, options)).rejects.toBeInstanceOf(ConflictError);
  });
  it("checks one edited date against the stored other one", async () => {
    const { service, repository } = memory();
    const goal = await service.create(owner, { ...numeric, starts_at: "2026-12-01T00:00:00Z", due_at: "2027-01-31T22:59:59.999Z" }, options);
    await expect(service.update(owner, goal.id, { due_at: "2026-11-30T22:59:59.999Z" }, options)).rejects.toBeInstanceOf(InvalidInputError);
    await expect(service.update(owner, goal.id, { starts_at: "2027-02-01T00:00:00Z" }, options)).rejects.toBeInstanceOf(InvalidInputError);
    expect(repository.updateActive).not.toHaveBeenCalled();
    expect(await service.update(owner, goal.id, { starts_at: null }, options)).toMatchObject({ starts_at: null });
  });
});

describe("reading and measuring a goal without measurements (LFS-225)", () => {
  const goal = goalSchema.parse({ id: randomUUID(), user_id: owner.userId, ...unmeasured, unit: null, unit_label: null, baseline: null, target: null,
    direction: null, status: "active", phase: "achieved", created_at: time, updated_at: time });
  it("has no percentage: the progress names the phase", () => {
    const details = goalDetailsFromRecord(owner, { goal, latest: null, measurementCount: 0, updatedAt: time });
    expect(goalDetailsSchema.parse(details).progress).toMatchObject({ status: "unmeasured", progressPercent: null, explanation: "Достигнута", methodology: null, unit: null });
  });
  it("refuses a measurement from a broken adapter and a new measurement with a conflict", async () => {
    const measurement = goalMeasurementSchema.parse({ id: randomUUID(), user_id: owner.userId, goal_id: goal.id, unit: "NOK", value: "1", measured_at: time,
      source: "manual", note: null, created_at: time, updated_at: time });
    expect(() => goalDetailsFromRecord(owner, { goal, latest: measurement, measurementCount: 1, updatedAt: time })).toThrow();
    const create = vi.fn<GoalMeasurementsRepository["create"]>();
    const unit = { goals: { find: vi.fn(async () => goal) }, measurements: { find: vi.fn(), latest: vi.fn(), list: vi.fn() },
      run: vi.fn(async (_actor, _command, operation) => ({ kind: "success" as const, result: await operation({ goals: { find: async () => goal, claimExample: vi.fn() },
        measurements: { create, find: vi.fn(), update: vi.fn(), remove: vi.fn(), latest: vi.fn(), list: vi.fn(), removeExamples: vi.fn() }, events: { append: vi.fn() } }) })) };
    const service = createGoalMeasurementsService(unit, () => new Date(time));
    await expect(service.create(owner, goal.id, { value: "1", measured_at: time }, options)).rejects.toBeInstanceOf(ConflictError);
    expect(create).not.toHaveBeenCalled();
  });
  it("shows a phase change and a start date edit in the journal", () => {
    const base = { id: randomUUID(), user_id: owner.userId, source: "web" as const, idempotency_key: "k", occurred_at: time, created_at: time,
      goal_id: goal.id, domain_key: "work" as const, target_type: "goal" as const, target_id: goal.id, schema_version: 1 as const, event_type: "goal.updated" as const };
    const snapshot = { unit: null, baseline: null, target: null, direction: null, status: "active" as const, due_at: null, kind: "unmeasured" as const, starts_at: null };
    const phase: ActivityEvent = { ...base, payload: { before: { ...snapshot, phase: "in_progress" }, after: { ...snapshot, phase: "achieved" }, changed_fields: ["phase"] } };
    const start: ActivityEvent = { ...base, payload: { before: { ...snapshot, phase: "in_progress" }, after: { ...snapshot, phase: "in_progress", starts_at: time }, changed_fields: ["starts_at"] } };
    expect(toActivityEntry({ event: phase, goal })).toMatchObject({ phase: { before: "in_progress", after: "achieved" }, startsAt: null, definition: null });
    expect(toActivityEntry({ event: start, goal })).toMatchObject({ startsAt: { before: null, after: time }, phase: null });
  });
});
