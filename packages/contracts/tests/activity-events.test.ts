import { describe, expect, it } from "vitest";
import { ACTIVITY_EVENT_TYPES, ACTIVITY_SOURCES, activityEventDraftSchema, activitySourceSchema, goalCommandOptionsSchema } from "../src/index.ts";

const goal = "56c83335-2be4-44af-87ec-7f74393cc35f";
const target = "a9b75401-d1e1-485b-badb-d3e4bb62d432";
const snapshot = { unit: "NOK", baseline: "0", target: "50000", direction: "increase", status: "active", due_at: null };
const base = { goal_id: goal, domain_key: "finance", target_type: "goal", target_id: goal, schema_version: 1 };
const created = { ...base, event_type: "goal.created", payload: { before: null, after: snapshot } };

describe("typed activity events", () => {
  it("defines the six event types and five sources, with only web/manual enabled for commands", () => {
    expect(ACTIVITY_EVENT_TYPES).toHaveLength(6);
    expect(ACTIVITY_SOURCES).toEqual(["manual", "web", "telegram", "import", "ai_proposed"]);
    for (const source of ACTIVITY_SOURCES) expect(activitySourceSchema.parse(source)).toBe(source);
    for (const source of ["web", "manual"]) expect(goalCommandOptionsSchema.parse({ source, idempotencyKey: "command-1" }).source).toBe(source);
  });
  it("accepts goal before/after and reserves typed measurement events without adding measurements", () => {
    for (const event of [created,
      { ...base, event_type: "goal.updated", payload: { before: snapshot, after: snapshot, changed_fields: ["title"] } },
      { ...base, event_type: "goal.updated", payload: { before: snapshot, after: snapshot, changed_fields: ["unit", "unit_label", "baseline", "target", "direction"] } },
      { ...base, event_type: "goal.archived", payload: { before: snapshot, after: { ...snapshot, status: "archived" } } },
    ]) expect(activityEventDraftSchema.safeParse(event).success).toBe(true);
    const measurement = { value: "12000.01", measured_at: "2026-11-15T10:00:00Z", source: "manual" };
    for (const [event_type, before, after] of [
      ["goal_measurement.created", null, measurement], ["goal_measurement.updated", measurement, measurement], ["goal_measurement.deleted", measurement, null],
    ]) expect(activityEventDraftSchema.safeParse({ ...base, target_type: "goal_measurement", target_id: target, event_type, payload: { before, after } }).success).toBe(true);
  });
  it.each([
    { ...created, user_id: "forged" }, { ...created, source: "web" }, { ...created, idempotency_key: "forged" },
    { ...created, schema_version: 2 }, { ...created, domain_key: "seventh" }, { ...created, target_id: target },
    { ...created, event_type: "goal.deleted" }, { ...created, target_type: "goal_measurement" },
    { ...created, payload: { before: null, after: { ...snapshot, email: "private@example.test" } } },
    { ...created, payload: { before: null, after: { ...snapshot, title: "private" } } },
    { ...created, payload: { before: null, after: { ...snapshot, target: 50000 } } },
    { ...created, payload: { before: null, after: snapshot, token: "private" } },
    { ...created, payload: { before: null, after: { ...snapshot, status: "archived" } } },
    { ...base, event_type: "goal.archived", payload: { before: snapshot, after: snapshot } },
    { ...base, event_type: "goal.updated", payload: { before: snapshot, after: snapshot, changed_fields: ["password"] } },
    { ...base, event_type: "goal.updated", payload: { before: snapshot, after: snapshot, changed_fields: [] } },
    { ...base, event_type: "goal.updated", payload: { before: snapshot, after: snapshot, changed_fields: ["title", "title"] } },
  ])("rejects forged metadata, secrets and incompatible snapshots %#", (event) => {
    expect(activityEventDraftSchema.safeParse(event).success).toBe(false);
  });
  it.each([undefined, {}, { source: "web", idempotencyKey: "" }, { source: "web", idempotencyKey: "bad\nkey" },
    { source: "telegram", idempotencyKey: "key" }, { source: "import", idempotencyKey: "key" }, { source: "ai_proposed", idempotencyKey: "key" },
    { source: "web", idempotencyKey: "key", userId: "other" },
  ])("rejects invalid or unimplemented command context %j", (context) => {
    expect(goalCommandOptionsSchema.safeParse(context).success).toBe(false);
  });
});
