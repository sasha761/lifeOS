import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { encodeGoalsCursor, encodeMeasurementsCursor, goalSchema } from "@lifeos/contracts";
import { actorFromVerifiedSession, createGoalsReader, InvalidInputError, NotFoundError } from "../src/index.ts";
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
