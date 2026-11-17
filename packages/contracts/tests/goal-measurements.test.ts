import { describe, expect, it } from "vitest";
import {
  createGoalMeasurementInputSchema, updateGoalMeasurementInputSchema, goalMeasurementSchema,
  goalMeasurementCurrentSchema, goalMeasurementDeletionSchema,
} from "../src/index.ts";

const input = { value: "9007199254740993.01", measured_at: "2026-11-15T11:00:00+01:00" };
const row = { ...input, id: "21739b75-dfe2-4f69-a5af-57cbb10123a7", goal_id: "18739b75-dfe2-4f69-a5af-57cbb10123a7", user_id: "owner",
  unit: "NOK", source: "manual", note: null, created_at: "2026-11-15T10:00:01Z", updated_at: "2026-11-15T10:00:01Z" };

describe("measurement contracts", () => {
  it("keeps exact decimals, normalizes offsets/text and defaults manual provenance", () => {
    expect(createGoalMeasurementInputSchema.parse({ ...input, value: "9007199254740993.01000000", note: " Private note " })).toEqual({
      value: input.value, measured_at: "2026-11-15T10:00:00.000Z", source: "manual", note: "Private note",
    });
    expect(createGoalMeasurementInputSchema.parse(input).note).toBeNull();
    expect(updateGoalMeasurementInputSchema.parse({ note: null })).toEqual({ note: null });
  });
  it.each([
    { value: 1 }, { value: "-1" }, { value: "1e3" }, { value: "0.000000001" }, { value: "10000000000000000000000" },
    { measured_at: "2026-11-15" }, { measured_at: "2026-02-30T00:00:00Z" }, { measured_at: "infinity" },
    { note: " " }, { note: "x".repeat(1001) }, { source: "bank" }, { source: "web" },
    { goal_id: row.goal_id }, { user_id: "other" }, { id: row.id }, { unit: "count" }, { created_at: row.created_at },
  ])("rejects malformed or client-controlled input %j", (changes) => {
    expect(createGoalMeasurementInputSchema.safeParse({ ...input, ...changes }).success).toBe(false);
  });
  it.each([{}, { value: undefined }, { source: "manual" }, { goal_id: row.goal_id }, { user_id: "other" }, { unit: "NOK" }, { note: "" }])(
    "rejects empty updates and changes to immutable fields %j", (changes) => {
      expect(updateGoalMeasurementInputSchema.safeParse(changes).success).toBe(false);
    },
  );
  it.each([
    ["NOK", "1.01", true], ["NOK", "1.001", false], ["count", "2", true], ["count", "2.1", false],
    ["percent", "100", true], ["percent", "100.00000001", false], ["minutes", "0.00000001", true], ["custom", "9999999999999999999999.99999999", true],
  ])("enforces inherited unit %s at value %s", (unit, value, accepted) => {
    expect(goalMeasurementSchema.safeParse({ ...row, unit, value }).success).toBe(accepted);
  });
  it("accepts only a consistent current projection or explicit no-data result", () => {
    const measurement = goalMeasurementSchema.parse(row);
    const result = { goal_id: row.goal_id, current: measurement.value, measurement };
    expect(goalMeasurementCurrentSchema.parse(result)).toEqual(result);
    expect(goalMeasurementCurrentSchema.parse({ goal_id: row.goal_id, current: null, measurement: null }).current).toBeNull();
    for (const change of [{ current: "0" }, { measurement: null }, { goal_id: row.id }]) {
      expect(goalMeasurementCurrentSchema.safeParse({ ...result, ...change }).success).toBe(false);
    }
    expect(goalMeasurementDeletionSchema.parse({ id: row.id, goal_id: row.goal_id, user_id: "owner", deleted: true }).deleted).toBe(true);
    expect(goalMeasurementDeletionSchema.safeParse({ ...row, deleted: true }).success).toBe(false);
  });
});
