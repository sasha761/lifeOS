import { describe, expect, it } from "vitest";
import { ACTIVITY_EVENT_TYPES, ACTIVITY_SOURCES, DOMAIN_KEYS } from "@lifeos/contracts";
import { activityLabel, dashboardTotals, dueState, formatDay, plural, sourceLabel } from "../lib/dashboard-presentation.ts";

describe("dashboard presentation (LFS-204)", () => {
  it("chooses Russian plural forms", () => {
    const forms = ["цель", "цели", "целей"] as const;
    expect([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map((count) => plural(count, forms)))
      .toEqual(["целей", "цель", "цели", "цели", "целей", "целей", "целей", "целей", "цель", "цели", "целей", "цель", "целей"]);
  });
  it("classifies deadlines by the account calendar day, not UTC", () => {
    // 23:30 UTC on 16 Nov is already 17 Nov 00:30 in Oslo.
    const now = new Date("2026-11-16T23:30:00Z");
    expect(dueState("2026-11-16T22:00:00Z", now, "Europe/Oslo")).toBe("overdue");
    expect(dueState("2026-11-17T20:00:00Z", now, "Europe/Oslo")).toBe("today");
    expect(dueState("2026-11-17T20:00:00Z", now, "UTC")).toBe("upcoming");
    expect(dueState("2026-11-16T23:45:00Z", now, "UTC")).toBe("today");
    expect(dueState("2026-11-16T23:45:00Z", now, "Invalid/Zone")).toBe("today");
  });
  it("labels every audit type and source without falling back to raw codes", () => {
    for (const type of ACTIVITY_EVENT_TYPES) expect(activityLabel(type)).toMatch(/^[А-ЯЁ]/);
    for (const source of ACTIVITY_SOURCES) expect(sourceLabel(source)).not.toBe(source === "telegram" ? "" : source);
  });
  it("sums exact counts only", () => {
    const domains = DOMAIN_KEYS.map((key, index) => ({ key, activeCount: index === 1 ? 3 : index === 5 ? 1 : 0, archivedCount: index === 2 ? 2 : 0, goals: [] }));
    expect(dashboardTotals({ domains, today: { dueGoals: [] }, activity: [], examples: { goals: 0, measurements: 0 } })).toEqual({ active: 4, archived: 2, spheres: 2 });
  });
  it("formats the current day in the account zone and survives an unknown zone", () => {
    expect(formatDay(new Date("2026-11-16T23:30:00Z"), { timezone: "Europe/Oslo", locale: "ru" })).toContain("17");
    expect(formatDay(new Date("2026-11-16T23:30:00Z"), { timezone: "Invalid/Zone", locale: "ru" })).toContain("16");
  });
});
