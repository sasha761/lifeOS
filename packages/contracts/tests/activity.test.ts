import { describe, expect, it } from "vitest";
import { ACTIVITY_LIMIT_DEFAULT, ACTIVITY_LIMIT_MAX, activityEntrySchema, activityFeedResponseSchema, activityFeedSchema, activityQuerySchema } from "../src/index.ts";

const time = "2026-11-15T10:00:00.000Z";
const goalId = "4fe63a56-7a7f-4905-bdc3-c9dff1d439dc";
function entry(type: string, extra: Record<string, unknown> = {}) {
  return { id: "5fe63a56-7a7f-4905-bdc3-c9dff1d439dc", type, occurredAt: time, source: "web", domainKey: "finance",
    goal: { id: goalId, title: "Savings", status: "active" }, measurement: null, changedFields: null, startsAt: null, dueAt: null, definition: null, phase: null, example: false, ...extra };
}
const measurement = (previousValue: string | null) => ({ value: "12000", previousValue, unit: "NOK", unitLabel: null });
const definition = { before: { unit: "NOK", baseline: "0", target: "5000", direction: "increase" }, after: { unit: "count", baseline: "2", target: "10", direction: "increase" } };

describe("activity journal contract (LFS-213)", () => {
  it("defaults the limit, accepts one filter and normalizes the goal id", () => {
    expect(activityQuerySchema.parse({})).toEqual({ limit: ACTIVITY_LIMIT_DEFAULT });
    expect(activityQuerySchema.parse({ domain_key: "health", limit: "5" })).toEqual({ domain_key: "health", limit: 5 });
    expect(activityQuerySchema.parse({ goal_id: goalId.toUpperCase() })).toEqual({ goal_id: goalId, limit: ACTIVITY_LIMIT_DEFAULT });
  });
  it.each([
    [{ domain_key: "finance", goal_id: goalId }], [{ user_id: "other" }], [{ cursor: "x" }], [{ domain_key: "seventh" }], [{ goal_id: "1" }],
    [{ limit: "0" }], [{ limit: String(ACTIVITY_LIMIT_MAX + 1) }], [{ limit: "01" }], [{ limit: "1.5" }],
  ])("rejects %j", (input) => {
    expect(activityQuerySchema.safeParse(input).success).toBe(false);
  });
  it("accepts entries whose details match their type", () => {
    for (const value of [
      entry("goal.created"),
      entry("goal.updated", { changedFields: ["title"] }),
      entry("goal.updated", { changedFields: ["due_at"], dueAt: { before: null, after: time } }),
      entry("goal_measurement.created", { measurement: measurement(null) }),
      entry("goal_measurement.updated", { measurement: measurement("8500") }),
      entry("goal_measurement.deleted", { measurement: measurement(null) }),
      entry("goal.updated", { changedFields: ["unit", "baseline", "target"], definition }),
      entry("goal.updated", { changedFields: ["title", "unit_label"] }),
      entry("goal_measurement.deleted", { measurement: { ...measurement(null), unit: null } }),
    ]) expect(activityEntrySchema.parse(value)).toEqual(value);
  });
  it.each([
    ["a goal edit without fields", entry("goal.updated")],
    ["fields on another type", entry("goal.created", { changedFields: ["title"] })],
    ["a deadline without the due_at field", entry("goal.updated", { changedFields: ["title"], dueAt: { before: null, after: time } })],
    ["due_at without the deadline values", entry("goal.updated", { changedFields: ["due_at"] })],
    ["a correction without the previous value", entry("goal_measurement.updated", { measurement: measurement(null) })],
    ["a previous value on a new measurement", entry("goal_measurement.created", { measurement: measurement("1") })],
    ["a measurement on a goal fact", entry("goal.created", { measurement: measurement(null) })],
    ["a user id", entry("goal.created", { user_id: "other" })],
    ["a definition change without its values", entry("goal.updated", { changedFields: ["target"] })],
    ["definition values without a definition field", entry("goal.updated", { changedFields: ["title"], definition })],
    ["a unit label without a unit", entry("goal_measurement.deleted", { measurement: { ...measurement(null), unit: null, unitLabel: "km" } })],
    ["an unknown changed field", entry("goal.updated", { changedFields: ["status"] })],
  ])("rejects %s", (_name, value) => {
    expect(activityEntrySchema.safeParse(value).success).toBe(false);
  });
  it("keeps the feed newest first and bounded, inside the common envelope", () => {
    const older = { ...entry("goal.created"), occurredAt: "2026-11-14T10:00:00.000Z" };
    expect(activityFeedSchema.safeParse({ items: [entry("goal.created"), older] }).success).toBe(true);
    expect(activityFeedSchema.safeParse({ items: [older, entry("goal.created")] }).success).toBe(false);
    expect(activityFeedSchema.safeParse({ items: Array.from({ length: ACTIVITY_LIMIT_MAX + 1 }, () => entry("goal.created")) }).success).toBe(false);
    expect(activityFeedResponseSchema.safeParse({ data: { items: [] }, meta: { request_id: goalId, correlation_id: goalId }, errors: [] }).success).toBe(true);
  });
});
