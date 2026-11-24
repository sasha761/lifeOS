import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { goalSchema, goalMeasurementSchema } from "@lifeos/contracts";
import { actorFromVerifiedSession, ConflictError, createGoalMeasurementsService, InvalidInputError, NotFoundError } from "../src/index.ts";
import type { ActivityEventWriter, GoalMeasurementsRepository, GoalMeasurementsUnitOfWork } from "../src/index.ts";

const actor = actorFromVerifiedSession("owner");
const context = { idempotencyKey: "unit-command", source: "web" };
const input = { value: "10.01", measured_at: "2026-11-15T10:00:00Z" };
function fixture() {
  const goal = goalSchema.parse({ id: randomUUID(), user_id: actor.userId, domain_key: "finance", title: "Save", unit: "NOK",
    baseline: "5", target: "20", direction: "increase", status: "active", created_at: input.measured_at, updated_at: input.measured_at });
  const measurement = goalMeasurementSchema.parse({ ...input, id: randomUUID(), user_id: actor.userId, goal_id: goal.id, unit: goal.unit,
    source: "manual", note: "Private text", created_at: input.measured_at, updated_at: input.measured_at });
  const measurements: GoalMeasurementsRepository = {
    create: vi.fn(async () => measurement), find: vi.fn(async () => measurement),
    update: vi.fn(async (_actor, _id, changes) => ({ ...measurement, ...changes })), remove: vi.fn(async () => measurement),
    list: vi.fn(async () => [measurement]), removeExamples: vi.fn(async () => []),
  };
  const goals = { find: vi.fn(async () => goal), claimExample: vi.fn(async () => ({ ...goal, origin: "manual" as const })) };
  const events = { append: vi.fn<ActivityEventWriter["append"]>(async () => {}) };
  const readCurrent = vi.fn<GoalMeasurementsUnitOfWork["readCurrent"]>(async () => ({ goal, latest: measurement, measurementCount: 1, updatedAt: goal.updated_at }));
  const unit: GoalMeasurementsUnitOfWork = { goals, measurements, readCurrent,
    run: vi.fn<GoalMeasurementsUnitOfWork["run"]>(async (_actor, _command, operation) => ({ kind: "success", result: await operation({ goals, measurements, events }) })) };
  const service = createGoalMeasurementsService(unit, () => new Date("2026-11-15T10:00:00Z"));
  return { goal, measurement, measurements, events, goals, unit, service, readCurrent };
}
describe("measurement business rules", () => {
  it("allows backdated values and values beyond the target, keeping note text out of audit", async () => {
    const { service, goal, measurements, events } = fixture();
    await service.create(actor, goal.id, { value: "21.01", measured_at: "2020-01-01T00:00:00Z", note: "Secret" }, context);
    expect(measurements.create).toHaveBeenCalledWith(actor, goal, { value: "21.01", measured_at: "2020-01-01T00:00:00.000Z", note: "Secret", source: "manual" });
    expect(events.append).toHaveBeenCalledWith(expect.objectContaining({ event_type: "goal_measurement.created", payload: { before: null,
      after: { value: input.value, measured_at: "2026-11-15T10:00:00.000Z", source: "manual" } } }));
    expect(JSON.stringify(events.append.mock.calls)).not.toContain("Private text");
  });
  it("enforces the five-minute future tolerance and parent unit on create and update", async () => {
    const { service, goal, measurement, measurements } = fixture();
    await service.create(actor, goal.id, { ...input, measured_at: "2026-11-15T10:05:00Z" }, context);
    for (const changes of [{ measured_at: "2026-11-15T10:05:00.001Z" }, { value: "1.001" }]) {
      await expect(service.create(actor, goal.id, { ...input, ...changes }, context)).rejects.toBeInstanceOf(InvalidInputError);
      await expect(service.update(actor, measurement.id, changes, context)).rejects.toBeInstanceOf(InvalidInputError);
    }
    expect(measurements.create).toHaveBeenCalledTimes(1);
    expect(measurements.update).not.toHaveBeenCalled();
  });
  it("returns no current without measurements even when baseline is nonzero", async () => {
    const { service, goal, readCurrent } = fixture();
    readCurrent.mockResolvedValue({ goal, latest: null, measurementCount: 0, updatedAt: goal.updated_at });
    expect(await service.current(actor, goal.id)).toEqual({ goal_id: goal.id, current: null, measurement: null });
  });
  it("records note-only edits without note contents and skips normalized no-op writes", async () => {
    const { service, measurement, measurements, events } = fixture();
    expect(await service.update(actor, measurement.id, { value: "10.0100", note: " Private text " }, context)).toEqual(measurement);
    expect(measurements.update).not.toHaveBeenCalled();
    expect(events.append).not.toHaveBeenCalled();
    await service.update(actor, measurement.id, { note: null }, context);
    expect(events.append).toHaveBeenCalledWith(expect.objectContaining({ payload: {
      before: { value: input.value, measured_at: measurement.measured_at, source: "manual" },
      after: { value: input.value, measured_at: measurement.measured_at, source: "manual" }, changed_fields: ["note"],
    } }));
  });
  it("preserves read access to archived parents and rejects all new writes", async () => {
    const { service, goal, measurement, measurements } = fixture();
    goal.status = "archived";
    expect(await service.get(actor, measurement.id)).toEqual(measurement);
    expect((await service.current(actor, goal.id)).current).toBe(measurement.value);
    await expect(service.create(actor, goal.id, input, context)).rejects.toBeInstanceOf(ConflictError);
    await expect(service.update(actor, measurement.id, { note: null }, context)).rejects.toBeInstanceOf(ConflictError);
    await expect(service.remove(actor, measurement.id, context)).rejects.toBeInstanceOf(ConflictError);
    expect(measurements.create).not.toHaveBeenCalled();
    expect(measurements.update).not.toHaveBeenCalled();
    expect(measurements.remove).not.toHaveBeenCalled();
  });
  it("rejects foreign parent/child rows even if returned by a broken repository", async () => {
    const { service, goal, measurement, measurements, readCurrent } = fixture();
    const foreign = actorFromVerifiedSession("other");
    for (const attempt of [() => service.create(foreign, goal.id, input, context), () => service.get(foreign, measurement.id),
      () => service.update(foreign, measurement.id, { note: null }, context), () => service.remove(foreign, measurement.id, context),
      () => service.current(foreign, goal.id), () => service.history(foreign, goal.id)]) {
      await expect(attempt()).rejects.toBeInstanceOf(NotFoundError);
    }
    readCurrent.mockResolvedValue({ goal, latest: { ...measurement, goal_id: randomUUID() }, measurementCount: 1, updatedAt: goal.updated_at });
    await expect(service.current(actor, goal.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(measurements.create).not.toHaveBeenCalled();
  });
  it("returns an owned deletion result and appends the prior value", async () => {
    const { service, goal, measurement, events } = fixture();
    expect(await service.remove(actor, measurement.id, context)).toEqual({ id: measurement.id, goal_id: goal.id, user_id: actor.userId, deleted: true });
    expect(events.append).toHaveBeenCalledWith(expect.objectContaining({ event_type: "goal_measurement.deleted", payload: {
      before: { value: measurement.value, measured_at: measurement.measured_at, source: "manual" }, after: null,
    } }));
  });
  it("rejects invalid identifiers, forged input and command context before persistence", async () => {
    const { service, goal, measurement, measurements, unit } = fixture();
    await expect(service.get(actor, "invalid")).rejects.toBeInstanceOf(NotFoundError);
    for (const options of [undefined, {}, { ...context, source: "bank" }]) {
      await expect(service.create(actor, goal.id, input, options)).rejects.toBeInstanceOf(InvalidInputError);
    }
    await expect(service.create(actor, goal.id, { ...input, user_id: "other" }, context)).rejects.toBeInstanceOf(InvalidInputError);
    await expect(service.update(actor, measurement.id, { source: "manual" }, context)).rejects.toBeInstanceOf(InvalidInputError);
    expect(unit.run).not.toHaveBeenCalled();
    expect(measurements.find).not.toHaveBeenCalled();
  });
  it("maps replay conflicts and deleted replay resources to safe errors", async () => {
    const { service, goal, unit } = fixture();
    unit.run = async () => ({ kind: "conflict" });
    await expect(service.create(actor, goal.id, input, context)).rejects.toBeInstanceOf(ConflictError);
    unit.run = async () => ({ kind: "not_found" });
    await expect(service.create(actor, goal.id, input, context)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("an own value replaces the example ones (LFS-218)", () => {
  it("removes the example values, makes the example goal the person's own and records the own value last", async () => {
    const { service, goal, measurements, events, goals } = fixture();
    const example = goalMeasurementSchema.parse({ ...input, value: "12", id: randomUUID(), user_id: actor.userId, goal_id: goal.id, unit: goal.unit,
      source: "example", note: "Пример", created_at: input.measured_at, updated_at: input.measured_at });
    goals.find.mockResolvedValue({ ...goal, origin: "starter" });
    vi.mocked(measurements.removeExamples).mockResolvedValueOnce([example]);
    await service.create(actor, goal.id, input, context);
    expect(goals.claimExample).toHaveBeenCalledExactlyOnceWith(actor, goal.id);
    expect(events.append.mock.calls.map(([event]) => [event.event_type, event.target_id])).toEqual([
      ["goal_measurement.deleted", example.id], ["goal.updated", goal.id], ["goal_measurement.created", expect.any(String)]]);
    expect(events.append.mock.calls[1]![0]).toMatchObject({ payload: { changed_fields: ["origin"] } });
    expect(vi.mocked(measurements.removeExamples).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(measurements.create).mock.invocationCallOrder[0]!);
  });
  it("does not claim a goal that is already the person's own", async () => {
    const { service, goal, goals, events } = fixture();
    await service.create(actor, goal.id, input, context);
    expect(goals.claimExample).not.toHaveBeenCalled();
    expect(events.append.mock.calls.map(([event]) => event.event_type)).toEqual(["goal_measurement.created"]);
  });
  it("refuses to correct an example value into the person's data", async () => {
    const { service, measurement, measurements } = fixture();
    vi.mocked(measurements.find).mockResolvedValueOnce({ ...measurement, source: "example" });
    await expect(service.update(actor, measurement.id, { value: "11" }, context)).rejects.toBeInstanceOf(ConflictError);
    expect(measurements.update).not.toHaveBeenCalled();
  });
});
