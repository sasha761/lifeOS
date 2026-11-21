import { describe, expect, it } from "vitest";
import {
  createGoalInputSchema, goalCalculationModeSchema, goalDecimalSchema, goalDecimalToScaledInteger,
  goalInstantSchema, goalSchema, updateGoalInputSchema,
} from "../src/index.ts";

const input = { domain_key: "finance", title: "Save", unit: "NOK", baseline: "0", target: "50000", direction: "increase" };

describe("exact goal decimals", () => {
  it.each([["0", "0"], ["0.00000000", "0"], ["12.34000000", "12.34"], ["0.00000001", "0.00000001"], ["9999999999999999999999.99999999", "9999999999999999999999.99999999"]])(
    "accepts and canonicalizes %s without Number", (value, expected) => {
      expect(goalDecimalSchema.parse(value)).toBe(expected);
    },
  );
  it.each([0, 0.1, NaN, Infinity, null, undefined, "", " 1", "1 ", "01", "+1", "-1", "-0", "1e3", "1,2", ".5", "1.", "NaN", "Infinity", "0.000000001", "10000000000000000000000"])(
    "rejects unsafe numeric input %j", (value) => { expect(goalDecimalSchema.safeParse(value).success).toBe(false); },
  );
  it("distinguishes adjacent amounts above Number.MAX_SAFE_INTEGER and exact subunits", () => {
    expect(goalDecimalToScaledInteger("9007199254740993.02") - goalDecimalToScaledInteger("9007199254740993.01")).toBe(1_000_000n);
    expect(goalDecimalToScaledInteger("0.00000002") - goalDecimalToScaledInteger("0.00000001")).toBe(1n);
  });
});

describe("manual goal definition", () => {
  it("normalizes text and explicit offsets, applies server-safe defaults", () => {
    expect(createGoalInputSchema.parse({ ...input, title: " Save ", due_at: "2026-11-15T23:30:00+01:00" })).toEqual({
      ...input, description: null, unit_label: null, calculation_mode: "manual", metric_key: null, due_at: "2026-11-15T22:30:00.000Z",
    });
    expect(goalCalculationModeSchema.parse("computed")).toBe("computed");
    expect(createGoalInputSchema.safeParse({ ...input, calculation_mode: "computed" }).success).toBe(false);
  });
  it.each([
    { baseline: "9007199254740993.01", target: "9007199254740993.02" },
    { baseline: "100000", target: "0", direction: "decrease" },
    { unit: "count", baseline: "0", target: "20" },
    { unit: "minutes", baseline: "0.00000001", target: "0.00000002" },
    { unit: "percent", baseline: "0", target: "100" },
    { unit: "custom", unit_label: " km ", baseline: "0", target: "12.5" },
  ])("accepts a meaningful unit/direction pair %j", (changes) => {
    expect(createGoalInputSchema.safeParse({ ...input, ...changes }).success).toBe(true);
  });
  it.each([
    { baseline: "10", target: "10" }, { baseline: "10.0", target: "10.00" },
    { target: "0" }, { direction: "decrease" }, { direction: "sideways" }, { baseline: "-1" },
    { baseline: "0.001" }, { unit: "count", target: "1.1" }, { unit: "percent", target: "100.00000001" },
    { unit: "custom" }, { unit_label: "km" }, { unit: "EUR" }, { unit: "custom", unit_label: " " },
    { domain_key: "seventh" }, { title: " " }, { title: "x".repeat(201) }, { description: "" },
    { description: "x".repeat(4001) }, { calculation_mode: "computed" }, { metric_key: "balance" },
    { user_id: "other" }, { userId: "other" }, { status: "archived" }, { id: "forged" },
    { due_at: "2026-11-15" }, { due_at: "2026-02-30T10:00:00Z" },
  ])("rejects invalid or client-controlled fields %j", (changes) => {
    expect(createGoalInputSchema.safeParse({ ...input, ...changes }).success).toBe(false);
  });
  it("returns an exact DTO with UTC instants and no fabricated current or progress", () => {
    const goal = goalSchema.parse({
      ...input, id: "dfdfb825-a0c7-4366-aa83-7737bac95f97", user_id: "owner", status: "active",
      created_at: "2026-11-15T10:00:00Z", updated_at: "2026-11-15T10:00:00Z",
    });
    expect(goal.baseline).toBe("0");
    expect(goal.created_at).toBe("2026-11-15T10:00:00.000Z");
    expect(goal).not.toHaveProperty("current");
    expect(goal).not.toHaveProperty("progressPercent");
  });
});

describe("goal editing and time", () => {
  it("allows metadata edits and explicit clearing of optional values", () => {
    expect(updateGoalInputSchema.parse({ title: " New ", description: null, due_at: null })).toEqual({ title: "New", description: null, due_at: null });
    expect(updateGoalInputSchema.parse({ due_at: "2020-01-01T00:00:00Z" }).due_at).toBe("2020-01-01T00:00:00.000Z");
  });
  it.each([{}, { title: undefined }, { baseline: "1" }, { target: "100" }, { unit: "count" }, { unit_label: "km" }, { direction: "decrease" }, { domain_key: "work" }, { calculation_mode: "computed" }, { metric_key: null }, { status: "archived" }, { user_id: "other" }, null, []])(
    "rejects empty updates, a partial definition and fields that never change %j", (value) => {
      expect(updateGoalInputSchema.safeParse(value).success).toBe(false);
    },
  );
  const definition = { unit: "count", unit_label: null, baseline: "2", target: "10", direction: "increase" };
  it("accepts a whole new definition with or without metadata and validates it like a new goal (LFS-217)", () => {
    expect(updateGoalInputSchema.parse(definition)).toEqual(definition);
    expect(updateGoalInputSchema.parse({ ...definition, unit: "custom", unit_label: " km ", target: "12.5", title: "Run" }))
      .toEqual({ ...definition, unit: "custom", unit_label: "km", target: "12.5", title: "Run" });
  });
  it.each([{ target: "2" }, { direction: "decrease" }, { target: "1.5" }, { unit: "custom" }, { unit_label: "km" }, { unit: "percent", target: "101" },
    { baseline: "-1" }, { unit_label: undefined }, { domain_key: "work" }])("rejects an invalid or incomplete definition %j", (change) => {
    expect(updateGoalInputSchema.safeParse({ ...definition, ...change }).success).toBe(false);
  });
  it.each(["infinity", "0000-01-01T00:00:00Z", "2026-11-15T10:00:00", "2026-11-15T10:00:00.1234Z", "9999-12-31T23:59:59-01:00"])(
    "rejects non-finite, ambiguous or lossy instants %s", (value) => { expect(goalInstantSchema.safeParse(value).success).toBe(false); },
  );
});
