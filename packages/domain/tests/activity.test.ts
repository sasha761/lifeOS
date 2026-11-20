import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { activityEventDraftSchema, activityEventMetadataSchema, activityFeedSchema, goalSchema } from "@lifeos/contracts";
import type { ActivityEvent, Goal } from "@lifeos/contracts";
import { actorFromVerifiedSession, createActivityReader, InvalidInputError } from "../src/index.ts";
import type { ActivityReadRepository, ActivityRecord } from "../src/index.ts";

const actor = actorFromVerifiedSession("owner");
const goal = goalSchema.parse({ id: randomUUID(), user_id: actor.userId, title: "Savings", domain_key: "finance", unit: "NOK", baseline: "0", target: "100",
  direction: "increase", status: "active", created_at: "2026-11-15T10:00:00Z", updated_at: "2026-11-15T10:00:00Z" });
const snapshot = { unit: "NOK", baseline: "0", target: "100", direction: "increase", status: "active" } as const;
const value = (amount: string) => ({ value: amount, measured_at: "2026-11-16T10:00:00Z", source: "manual" });
function record(type: string, payload: unknown, occurredAt: string, { owner = actor.userId, of = goal }: { owner?: string; of?: Goal } = {}): ActivityRecord {
  const draft = activityEventDraftSchema.parse({ goal_id: of.id, domain_key: of.domain_key, target_id: type.startsWith("goal.") ? of.id : randomUUID(),
    target_type: type.startsWith("goal.") ? "goal" : "goal_measurement", event_type: type, schema_version: 1, payload });
  const event: ActivityEvent = { ...draft, ...activityEventMetadataSchema.parse({ id: randomUUID(), user_id: owner, source: "web", idempotency_key: null, occurred_at: occurredAt, created_at: occurredAt }) };
  return { event, goal: of };
}
function reader(records: ActivityRecord[]) {
  const repository: ActivityReadRepository = { list: vi.fn(async () => records) };
  return { repository, service: createActivityReader(repository) };
}

describe("activity journal reader (LFS-213)", () => {
  it("reports deadline edits, corrected values and deletions only from the stored payload, newest first", async () => {
    const { service, repository } = reader([
      record("goal_measurement.deleted", { before: value("15000"), after: null }, "2026-11-16T09:00:00Z"),
      record("goal.updated", { before: { ...snapshot, due_at: "2026-11-30T22:59:59.999Z" }, after: { ...snapshot, due_at: "2026-12-31T22:59:59.999Z" },
        changed_fields: ["due_at"] }, "2026-11-16T12:00:00Z"),
      record("goal_measurement.updated", { before: value("8500"), after: value("12000") }, "2026-11-16T11:00:00Z"),
    ]);
    const feed = activityFeedSchema.parse(await service.list(actor, { goal_id: goal.id.toUpperCase(), limit: "5" }));
    expect(repository.list).toHaveBeenCalledWith(actor, { domainKey: null, goalId: goal.id, limit: 5 });
    expect(feed.items.map((item) => item.type)).toEqual(["goal.updated", "goal_measurement.updated", "goal_measurement.deleted"]);
    expect(feed.items[0]).toMatchObject({ changedFields: ["due_at"], dueAt: { before: "2026-11-30T22:59:59.999Z", after: "2026-12-31T22:59:59.999Z" }, measurement: null });
    expect(feed.items[1]).toMatchObject({ measurement: { value: "12000", previousValue: "8500", unit: "NOK" }, changedFields: null });
    expect(feed.items[2]).toMatchObject({ measurement: { value: "15000", previousValue: null } });
  });

  it("hides foreign, mismatched and filtered-out facts even if a repository returned them", async () => {
    const health = goalSchema.parse({ ...goal, id: randomUUID(), domain_key: "health", unit: "count", target: "10" });
    const created = { before: null, after: { ...snapshot, due_at: null } };
    const { service } = reader([
      record("goal.created", created, "2026-11-16T10:00:00Z"),
      record("goal.created", created, "2026-11-16T10:01:00Z", { owner: "other" }),
      record("goal.created", { before: null, after: { ...snapshot, unit: "count", target: "10", due_at: null } }, "2026-11-16T10:02:00Z", { of: health }),
    ]);
    const finance = await service.list(actor, { domain_key: "finance" });
    expect(finance.items.map((item) => item.goal.id)).toEqual([goal.id]);
  });

  it("shows a redefinition with its values and drops the unit of measurements recorded before the unit changed (LFS-217)", async () => {
    const counted = goalSchema.parse({ ...goal, unit: "count", target: "10" });
    const changedAt = "2026-11-16T12:00:00.000Z";
    const at = (entry: ActivityRecord) => ({ ...entry, goal: counted, unitChangedAt: changedAt });
    const { service } = reader([
      at(record("goal_measurement.deleted", { before: value("1200"), after: null }, "2026-11-16T11:00:00Z")),
      at(record("goal.updated", { before: { ...snapshot, due_at: null }, after: { ...snapshot, unit: "count", target: "10", due_at: null },
        changed_fields: ["unit", "target"] }, changedAt)),
      at(record("goal_measurement.created", { before: null, after: value("3") }, "2026-11-16T13:00:00Z")),
    ]);
    const feed = activityFeedSchema.parse(await service.list(actor, { goal_id: goal.id }));
    expect(feed.items[0]).toMatchObject({ type: "goal_measurement.created", measurement: { value: "3", unit: "count" } });
    expect(feed.items[1]).toMatchObject({ type: "goal.updated", changedFields: ["unit", "target"], dueAt: null,
      definition: { before: { unit: "NOK", target: "100" }, after: { unit: "count", target: "10" } } });
    expect(feed.items[2]).toMatchObject({ type: "goal_measurement.deleted", measurement: { value: "1200", unit: null, unitLabel: null } });
  });

  it.each([{ domain_key: "finance", goal_id: goal.id }, { user_id: "other" }, { limit: "0" }, null])("rejects %j before reading", async (input) => {
    const { service, repository } = reader([]);
    await expect(service.list(actor, input)).rejects.toBeInstanceOf(InvalidInputError);
    expect(repository.list).not.toHaveBeenCalled();
  });
});
