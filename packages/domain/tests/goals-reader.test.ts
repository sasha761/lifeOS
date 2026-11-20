import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { encodeGoalsCursor, encodeMeasurementsCursor, goalDetailsSchema, goalMeasurementSchema, goalSchema } from "@lifeos/contracts";
import { actorFromVerifiedSession, createGoalsReader, goalDetailsFromRecord, InvalidInputError, NotFoundError } from "../src/index.ts";
import type { GoalReadRecord, GoalsReadRepository } from "../src/index.ts";

const actor = actorFromVerifiedSession("owner");
function fixture() {
  const goal = goalSchema.parse({ id: randomUUID(), user_id: actor.userId, title: "Read", domain_key: "finance", unit: "NOK", baseline: "10", target: "20",
    direction: "increase", status: "active", created_at: "2026-11-15T10:00:00Z", updated_at: "2026-11-15T10:00:00Z" });
  const record: GoalReadRecord = { goal, latest: null, measurementCount: 0, updatedAt: goal.updated_at };
  const repository: GoalsReadRepository = { find: vi.fn(async () => record), list: vi.fn(async () => [record]),
    history: vi.fn(async () => ({ goal, items: [], measurementCount: 0 })) };
  return { goal, record, repository, service: createGoalsReader(repository) };
}
describe("owned goal read boundary", () => {
  it("projects empty goals without manufacturing current from baseline", async () => {
    const { service, goal } = fixture();
    expect((await service.get(actor, goal.id)).progress).toMatchObject({ current: null, progressPercent: null, measurementCount: 0 });
    expect((await service.list(actor, {})).items).toHaveLength(1);
    expect(await service.history(actor, goal.id, {})).toEqual({ items: [], nextCursor: null, measurementCount: 0 });
  });
  it("rejects foreign rows from a broken adapter for detail, list and history", async () => {
    const { service, goal } = fixture();
    const other = actorFromVerifiedSession("other");
    await expect(service.get(other, goal.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.list(other, {})).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.history(other, goal.id, {})).rejects.toBeInstanceOf(NotFoundError);
  });
  it("rejects malformed ids and mismatched cursor scopes before repository calls", async () => {
    const { service, goal, repository } = fixture();
    await expect(service.get(actor, "invalid")).rejects.toBeInstanceOf(NotFoundError);
    const cursor = encodeGoalsCursor({ created_at: goal.created_at, id: goal.id, domain_key: "finance", status: "active" });
    await expect(service.list(actor, { cursor, domain_key: "health", status: "active" })).rejects.toBeInstanceOf(InvalidInputError);
    const historyCursor = encodeMeasurementsCursor({ id: randomUUID(), goal_id: randomUUID(), measured_at: goal.created_at, created_at: goal.created_at });
    await expect(service.history(actor, goal.id, { cursor: historyCursor })).rejects.toBeInstanceOf(InvalidInputError);
    expect(repository.find).not.toHaveBeenCalled(); expect(repository.list).not.toHaveBeenCalled(); expect(repository.history).not.toHaveBeenCalled();
  });
  it("rejects a contradictory count/latest summary rather than returning a fabricated percentage", async () => {
    const { service, record, goal } = fixture();
    record.measurementCount = 1;
    await expect(service.get(actor, goal.id)).rejects.toThrow("Invalid measurement summary.");
  });
});

describe("example current value (LFS-218)", () => {
  it("is shown as an example, not as the person's self-report", () => {
    const actor = actorFromVerifiedSession("owner");
    const goal = goalSchema.parse({ id: randomUUID(), user_id: actor.userId, domain_key: "finance", title: "Накопить 5 000 $", unit: "USD", baseline: "0", target: "5000",
      direction: "increase", status: "active", origin: "starter", created_at: "2026-11-18T19:40:00Z", updated_at: "2026-11-18T19:40:00Z" });
    const latest = goalMeasurementSchema.parse({ id: randomUUID(), goal_id: goal.id, user_id: actor.userId, unit: "USD", value: "1200", measured_at: "2026-11-18T19:40:00Z",
      source: "example", note: null, created_at: "2026-11-18T19:40:00Z", updated_at: "2026-11-18T19:40:00Z" });
    const details = goalDetailsSchema.parse(goalDetailsFromRecord(actor, { goal, latest, measurementCount: 1, updatedAt: latest.updated_at }));
    expect(details.progress.provenance).toMatchObject({ kind: "example", source: "example", measurementId: latest.id });
    expect(details.progress).toMatchObject({ current: "1200", progressPercent: 24 });
    expect(details.goal.origin).toBe("starter");
  });
});
