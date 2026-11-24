import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "@lifeos/contracts";
import { describeActivity as describe_ } from "../lib/activity-presentation.ts";
import { daysUntil, formatDaysLeft, sourceLabel } from "../lib/dashboard-presentation.ts";
import { formatGoalValue, goalUnitOptionLabel, remainingToTarget } from "../lib/goal-presentation.ts";

const preferences = { timezone: "Europe/Oslo", locale: "ru" };
const base = { id: "5fe63a56-7a7f-4905-bdc3-c9dff1d439dc", occurredAt: "2026-11-14T10:00:00.000Z", source: "web", domainKey: "finance",
  goal: { id: "4fe63a56-7a7f-4905-bdc3-c9dff1d439dc", title: "Накопить 50 000 NOK", status: "active" }, measurement: null, changedFields: null, startsAt: null, dueAt: null, definition: null, phase: null, example: false } as const;
const entry = (value: Partial<ActivityEntry>): ActivityEntry => ({ ...base, type: "goal.created", ...value } as ActivityEntry);
/** Russian grouping uses a no-break space; compare with plain spaces. */
const describeActivity = (...args: Parameters<typeof describe_>) => describe_(...args).replace(/[  ]/g, " ");
const nok = (value: string, previousValue: string | null = null) => ({ value, previousValue, unit: "NOK", unitLabel: null }) as const;

describe("journal sentences (LFS-213, mockups 09 and 10)", () => {
  it("describes deadline edits with stored dates and corrections with the previous value", () => {
    expect(describeActivity(entry({ type: "goal.updated", changedFields: ["due_at"], dueAt: { before: "2026-11-30T22:59:59.999Z", after: "2026-12-31T22:59:59.999Z" } }), preferences))
      .toBe("Срок изменён: 30.11.2026 → 31.12.2026");
    expect(describeActivity(entry({ type: "goal.updated", changedFields: ["title", "due_at"], dueAt: { before: null, after: "2026-12-31T22:59:59.999Z" } }), preferences))
      .toBe("Название изменено, срок изменён: без срока → 31.12.2026");
    expect(describeActivity(entry({ type: "goal_measurement.updated", measurement: nok("12000", "8500") }), preferences, { withTitle: true }))
      .toBe("Исправлено измерение «Накопить 50 000 NOK»: 8 500 → 12 000 NOK");
    expect(describeActivity(entry({ type: "goal_measurement.updated", measurement: nok("12000", "12000") }), preferences)).toBe("Исправлено измерение: 12 000 NOK");
  });
  it("names the goal only in sphere-wide lists", () => {
    expect(describeActivity(entry({}), preferences)).toBe("Создана цель");
    expect(describeActivity(entry({}), preferences, { withTitle: true })).toBe("Создана цель «Накопить 50 000 NOK»");
    expect(describeActivity(entry({ type: "goal.archived" }), preferences, { withTitle: true })).toBe("Цель «Накопить 50 000 NOK» перенесена в архив");
    expect(describeActivity(entry({ type: "goal_measurement.created", measurement: nok("8500") }), preferences)).toBe("Добавлено измерение: 8 500 NOK");
    expect(describeActivity(entry({ type: "goal_measurement.deleted", measurement: nok("8500") }), preferences)).toBe("Удалено измерение: 8 500 NOK");
  });
});

describe("journal sentences for a redefined goal (LFS-217)", () => {
  const definition = { before: { unit: "NOK", baseline: "2", target: "5000", direction: "increase" }, after: { unit: "custom", baseline: "3", target: "4", direction: "decrease" } } as const;
  it("shows stored definition values in reading order, the deadline last", () => {
    expect(describeActivity(entry({ type: "goal.updated", changedFields: ["due_at", "unit", "unit_label", "baseline", "target", "direction"], definition,
      dueAt: { before: null, after: "2026-12-31T22:59:59.999Z" } }), preferences))
      .toBe("Единица изменена: NOK → своя единица, название единицы изменено, старт изменён: 2 → 3, цель изменена: 5 000 → 4, "
        + "направление изменено: увеличить → уменьшить, срок изменён: без срока → 31.12.2026");
    expect(describeActivity(entry({ type: "goal.updated", changedFields: ["target"], definition }), preferences, { withTitle: true }))
      .toBe("Цель «Накопить 50 000 NOK»: цель изменена: 5 000 → 4");
  });
  it("shows a value entered before the unit changed as a plain number", () => {
    expect(describeActivity(entry({ type: "goal_measurement.deleted", measurement: { value: "1200", previousValue: null, unit: null, unitLabel: null } }), preferences))
      .toBe("Удалено измерение: 1 200");
  });
});

describe("«Осталось» tile", () => {
  it("subtracts exact decimals by direction and stops at zero", () => {
    expect(remainingToTarget({ direction: "increase", target: "50000" }, "12000")).toBe("38000");
    expect(remainingToTarget({ direction: "decrease", target: "0" }, "80000")).toBe("80000");
    expect(remainingToTarget({ direction: "increase", target: "9007199254740993.05" }, "9007199254740993.02")).toBe("0.03");
    expect(remainingToTarget({ direction: "increase", target: "0.00000005" }, "0.00000002")).toBe("0.00000003");
    expect(remainingToTarget({ direction: "increase", target: "50000" }, "60000")).toBe("0");
    expect(remainingToTarget({ direction: "decrease", target: "20" }, "10")).toBe("0");
  });
  it("counts calendar days in the account zone", () => {
    const now = new Date("2026-11-17T23:30:00Z"); // 00:30 on 18 November in Oslo (UTC+1)
    expect(daysUntil("2026-11-18T22:59:59.999Z", now, "Europe/Oslo")).toBe(0);
    expect(daysUntil("2026-12-31T22:59:59.999Z", now, "Europe/Oslo")).toBe(43);
    expect(daysUntil("2026-11-17T12:00:00Z", now, "Europe/Oslo")).toBe(-1);
    expect([formatDaysLeft(0), formatDaysLeft(1), formatDaysLeft(3), formatDaysLeft(44), formatDaysLeft(-2)]).toEqual(["сегодня", "1 день", "3 дня", "44 дня", "срок прошёл"]);
  });
});

describe("the example in words (LFS-218)", () => {
  it("says that an example became the person's own goal, after the other changes", () => {
    expect(describeActivity(entry({ type: "goal.updated", changedFields: ["origin"] }), preferences)).toBe("Метка «Пример» снята");
    expect(describeActivity(entry({ type: "goal.updated", changedFields: ["title", "origin"] }), preferences, { withTitle: true }))
      .toBe("Цель «Накопить 50 000 NOK»: название изменено, метка «Пример» снята");
  });
  it("names the source of example facts and formats dollars after the number", () => {
    expect(sourceLabel("starter")).toBe("стартовый набор");
    expect(formatGoalValue("5000", { unit: "USD", unit_label: null }, "ru").replace(/[  ]/g, " ")).toBe("5 000 $");
    expect(formatGoalValue("1200.5", { unit: "USD", unit_label: null }, "ru").replace(/[  ]/g, " ")).toBe("1 200,5 $");
    expect(goalUnitOptionLabel("USD")).toBe("USD ($)");
    expect(goalUnitOptionLabel("NOK")).toBe("NOK");
  });
});
