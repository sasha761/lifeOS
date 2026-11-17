import { describe, expect, it } from "vitest";
import { calculateGoalProgress, InvalidInputError } from "../src/index.ts";

const increase = (baseline: string, target: string, current: string | null) => ({ direction: "increase", baseline, target, current });
describe("exact manual goal progress", () => {
  it.each([
    ["0", "50000", "12000", 24], ["0", "50000", "0", 0], ["10", "20", "5", 0], ["10", "20", "30", 100],
    ["0", "3", "1", 33.33], ["0", "3", "2", 66.67], ["0", "20000", "1", 0.01],
    ["9007199254740993.01", "9007199254740993.05", "9007199254740993.02", 25],
    ["9999999999999999999999.99999995", "9999999999999999999999.99999999", "9999999999999999999999.99999996", 25],
    ["0.00000001", "0.00000005", "0.00000002", 25],
  ])("increase %s → %s at %s yields %s%%", (baseline, target, current, percent) => {
    expect(calculateGoalProgress(increase(baseline, target, current))).toEqual({ status: "measured", progressPercent: percent, explanation: null });
  });
  it.each([["100000", "0", "80000", 20], ["100", "20", "120", 0], ["100", "20", "0", 100], ["100", "20", "20", 100],
    ["9007199254740993.05", "9007199254740993.01", "9007199254740993.04", 25]])(
    "decrease %s → %s at %s yields %s%%", (baseline, target, current, percent) => {
      expect(calculateGoalProgress({ baseline, target, current, direction: "decrease" }).progressPercent).toBe(percent);
    },
  );
  it("distinguishes missing measurements from an actual measured zero and never mutates current", () => {
    expect(calculateGoalProgress(increase("0", "50000", null))).toEqual({ status: "insufficient_data", progressPercent: null, explanation: "Недостаточно данных" });
    const input = increase("0", "1", "2");
    expect(calculateGoalProgress(input).progressPercent).toBe(100);
    expect(input.current).toBe("2");
  });
  it.each([increase("1", "1", "1"), increase("2", "1", "1"), { direction: "decrease", baseline: "1", target: "2", current: "1" }])(
    "handles degenerate and reversed definitions without division by zero %j", (input) => {
      expect(calculateGoalProgress(input)).toEqual({ status: "invalid_definition", progressPercent: null, explanation: "Некорректное определение цели" });
    },
  );
  it.each([{ current: "-1" }, { current: 0 }, { current: "1e3" }, { current: "NaN" }, { current: "0.000000001" }, { baseline: "Infinity" }, { user_id: "forged" }])(
    "rejects invalid calculation input %j", (changes) => { expect(() => calculateGoalProgress({ ...increase("0", "1", "0"), ...changes })).toThrow(InvalidInputError); },
  );
});
