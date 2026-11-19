import { describe, expect, it } from "vitest";
import { decodeGoalsCursor, decodeMeasurementsCursor, encodeGoalsCursor, encodeMeasurementsCursor, goalDeletionSchema, goalsListQuerySchema,
  measurementsListQuerySchema, patchGoalInputSchema, progressComputationSchema } from "../src/index.ts";

const id = "4fe63a56-7a7f-4905-bdc3-c9dff1d439dc";
const time = "2026-11-15T10:00:00.000Z";
describe("goals HTTP contracts", () => {
  it("validates the minimal goal deletion result", () => {
    const result = { id, user_id: "owner", deleted: true };
    expect(goalDeletionSchema.parse(result)).toEqual(result);
    for (const invalid of [{ ...result, deleted: false }, { ...result, user_id: "" }, { ...result, user_id: "x".repeat(129) }, { ...result, id: "bad" }, { ...result, title: "private" }]) {
      expect(goalDeletionSchema.safeParse(invalid).success).toBe(false);
    }
  });
  it("bounds page size and normalizes query limit", () => {
    expect(goalsListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(goalsListQuerySchema.parse({ limit: "100", domain_key: "finance", status: "active" })).toEqual({ limit: 100, domain_key: "finance", status: "active" });
    expect(measurementsListQuerySchema.parse({ limit: 1 })).toEqual({ limit: 1 });
  });
  it.each([{ limit: "0" }, { limit: "101" }, { limit: "1.5" }, { limit: "1e2" }, { limit: "01" }, { limit: true }, { limit: null },
    { domain_key: "unknown" }, { status: "deleted" }, { user_id: "other" }, { cursor: "invalid" }, { cursor: "x".repeat(513) }])(
    "rejects unsafe filters and seek input %j", (input) => { expect(goalsListQuerySchema.safeParse(input).success).toBe(false); },
  );
  it("roundtrips complete seek positions without depending on the cursor row still existing", () => {
    const goal = { id, created_at: time, domain_key: "finance" as const, status: "active" as const };
    const measurement = { id, goal_id: id, measured_at: time, created_at: time };
    expect(decodeGoalsCursor(encodeGoalsCursor(goal))).toEqual(goal);
    expect(decodeMeasurementsCursor(encodeMeasurementsCursor(measurement))).toEqual(measurement);
    expect(measurementsListQuerySchema.parse({ cursor: encodeMeasurementsCursor(measurement) }).cursor).toBe(encodeMeasurementsCursor(measurement));
    expect(decodeGoalsCursor(encodeMeasurementsCursor(measurement))).toBeNull();
    expect(decodeMeasurementsCursor(encodeGoalsCursor(goal))).toBeNull();
    expect(decodeMeasurementsCursor(`m2!${id}!${time}!${time}!${id}`)).toBeNull();
    expect(decodeMeasurementsCursor(`m1!${id}!infinity!${time}!${id}`)).toBeNull();
    expect(decodeGoalsCursor(`${encodeGoalsCursor(goal)}!extra`)).toBeNull();
  });
  it("archives separately from metadata and forbids reopening or redefining historical measurements", () => {
    expect(patchGoalInputSchema.parse({ status: "archived" })).toEqual({ status: "archived" });
    expect(patchGoalInputSchema.parse({ title: " New " })).toEqual({ title: "New" });
    for (const input of [{ status: "active" }, { title: "Mixed", status: "archived" }, { baseline: "2" }, { target: "3" }, { unit: "count" }, { user_id: "other" }]) {
      expect(patchGoalInputSchema.safeParse(input).success).toBe(false);
    }
  });
  it("rejects contradictory missing-data percentages and nonfinite percentages", () => {
    expect(progressComputationSchema.safeParse({ status: "insufficient_data", progressPercent: 0, explanation: "Недостаточно данных" }).success).toBe(false);
    for (const progressPercent of [-1, 101, NaN, Infinity, null]) {
      expect(progressComputationSchema.safeParse({ status: "measured", progressPercent, explanation: null }).success).toBe(false);
    }
  });
});
