import { describe, expect, it } from "vitest";
import {
  activityEventDraftSchema, createGoalInputSchema, createNumericGoalInputSchema, createGoalMeasurementInputSchema, dashboardSchema, DOMAIN_KEYS, goalMeasurementSchema,
  goalProgressSchema, goalSchema, goalValueMatchesUnit, starterPackAppliedSchema, starterPackRemovedSchema, updateGoalInputSchema,
} from "../src/index.ts";

const id = "4fe63a56-7a7f-4905-bdc3-c9dff1d439dc";
const time = "2026-11-18T19:40:00.000Z";
const goal = { id, user_id: "owner", domain_key: "finance", title: "Накопить 5 000 $", unit: "USD", baseline: "0", target: "5000",
  direction: "increase", status: "active", created_at: time, updated_at: time };
const measurement = { id, goal_id: id, user_id: "owner", unit: "USD", value: "1200", measured_at: time, note: "Пример — замените своим значением или удалите",
  created_at: time, updated_at: time };

describe("USD (LFS-218)", () => {
  it("is a money unit with two decimal places, like NOK, and keeps no conversion", () => {
    expect(goalValueMatchesUnit("1200.55", "USD")).toBe(true);
    expect(goalValueMatchesUnit("1200.555", "USD")).toBe(false);
    expect(createNumericGoalInputSchema.parse({ domain_key: "finance", title: "Save", unit: "USD", baseline: "0", target: "5000.5", direction: "increase" }).unit).toBe("USD");
    expect(createGoalInputSchema.safeParse({ domain_key: "finance", title: "Save", unit: "USD", baseline: "0", target: "5000.505", direction: "increase" }).success).toBe(false);
    expect(createGoalInputSchema.safeParse({ domain_key: "finance", title: "Save", unit: "USD", unit_label: "$", baseline: "0", target: "5000", direction: "increase" }).success).toBe(false);
  });
});

describe("goal origin (LFS-218)", () => {
  it("is part of the goal DTO, reads an absent value as the person's own and rejects unknown origins", () => {
    expect(goalSchema.parse({ ...goal, origin: "starter" }).origin).toBe("starter");
    expect(goalSchema.parse({ ...goal, origin: "onboarding" }).origin).toBe("onboarding");
    expect(goalSchema.parse(goal).origin).toBe("manual");
    expect(goalSchema.safeParse({ ...goal, origin: "import" }).success).toBe(false);
  });
  it.each([createGoalInputSchema, updateGoalInputSchema])("is never accepted from a client (%#)", (schema) => {
    expect(schema.safeParse({ domain_key: "finance", title: "Save", unit: "NOK", baseline: "0", target: "10", direction: "increase", origin: "manual" }).success).toBe(false);
    expect(schema.safeParse({ title: "Save", origin: "starter" }).success).toBe(false);
  });
});

describe("example measurements and facts (LFS-218)", () => {
  it("labels an example value in the DTO, but the public input creates manual values only", () => {
    expect(goalMeasurementSchema.parse({ ...measurement, source: "example" }).source).toBe("example");
    expect(goalMeasurementSchema.safeParse({ ...measurement, source: "import" }).success).toBe(false);
    expect(createGoalMeasurementInputSchema.safeParse({ value: "1", measured_at: time, source: "example" }).success).toBe(false);
  });
  it("audits example values and an example becoming the person's own goal", () => {
    const base = { goal_id: id, domain_key: "finance", target_id: id, schema_version: 1 };
    const snapshot = { unit: "USD", baseline: "0", target: "5000", direction: "increase", status: "active", due_at: null };
    expect(activityEventDraftSchema.safeParse({ ...base, target_type: "goal_measurement", event_type: "goal_measurement.created",
      payload: { before: null, after: { value: "1200", measured_at: time, source: "example" } } }).success).toBe(true);
    expect(activityEventDraftSchema.safeParse({ ...base, target_type: "goal", event_type: "goal.updated",
      payload: { before: snapshot, after: snapshot, changed_fields: ["origin"] } }).success).toBe(true);
    expect(activityEventDraftSchema.safeParse({ ...base, target_type: "goal", event_type: "goal.updated",
      payload: { before: snapshot, after: { ...snapshot, origin: "manual" }, changed_fields: ["origin"] } }).success).toBe(false);
  });
  it("tells an example current value from a self-report", () => {
    const progress = { methodology: { version: 1, mode: "manual", formula: "(current-baseline)/(target-baseline)", percentDecimals: 2, rounding: "half_up", clamped: true },
      source: "manual", unit: "USD", baseline: "0", target: "5000", current: "1200", status: "measured", progressPercent: 24, explanation: null,
      updatedAt: time, measurementCount: 1 };
    const provenance = { measurementId: id, measuredAt: time, recordedAt: time, updatedAt: time };
    expect(goalProgressSchema.safeParse({ ...progress, provenance: { ...provenance, kind: "example", source: "example" } }).success).toBe(true);
    expect(goalProgressSchema.safeParse({ ...progress, provenance: { ...provenance, kind: "self_report", source: "manual" } }).success).toBe(true);
    expect(goalProgressSchema.safeParse({ ...progress, provenance: { ...provenance, kind: "self_report", source: "example" } }).success).toBe(false);
    expect(goalProgressSchema.safeParse({ ...progress, provenance: { ...provenance, kind: "example", source: "manual" } }).success).toBe(false);
  });
});

describe("example commands and the dashboard banner (LFS-218)", () => {
  it("reports created and deleted counts only", () => {
    expect(starterPackAppliedSchema.parse({ version: 1, created_goals: 7, created_measurements: 7 })).toEqual({ version: 1, created_goals: 7, created_measurements: 7 });
    for (const value of [{ version: 2, created_goals: 7, created_measurements: 7 }, { version: 1, created_goals: -1, created_measurements: 7 },
      { version: 1, created_goals: 7, created_measurements: 7, goals: [] }]) expect(starterPackAppliedSchema.safeParse(value).success).toBe(false);
    expect(starterPackRemovedSchema.parse({ deleted_goals: 0 })).toEqual({ deleted_goals: 0 });
    expect(starterPackRemovedSchema.safeParse({ deleted_goals: 1.5 }).success).toBe(false);
  });
  it("requires exact non-negative example counts on the dashboard", () => {
    const dashboard = { domains: DOMAIN_KEYS.map((key) => ({ key, activeCount: 0, archivedCount: 0, goals: [] })), today: { dueGoals: [] }, activity: [] };
    expect(dashboardSchema.safeParse({ ...dashboard, examples: { goals: 7, measurements: 7 } }).success).toBe(true);
    expect(dashboardSchema.safeParse(dashboard).success).toBe(false);
    expect(dashboardSchema.safeParse({ ...dashboard, examples: { goals: -1, measurements: 0 } }).success).toBe(false);
  });
});
