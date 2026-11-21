import { describe, expect, it } from "vitest";
import { DASHBOARD_ACTIVITY_LIMIT, DASHBOARD_GOALS_PER_DOMAIN, dashboardResponseSchema, dashboardSchema, DOMAIN_KEYS } from "../src/index.ts";

const time = "2026-11-15T10:00:00.000Z";
let sequence = 0;
const uuid = () => `4fe63a56-7a7f-4905-bdc3-${(++sequence).toString(16).padStart(12, "0")}`;
function details(overrides: { domain_key?: string; status?: string; due_at?: string | null } = {}) {
  return {
    goal: { id: uuid(), user_id: "owner", domain_key: "finance", title: "Savings", description: null, unit: "NOK", unit_label: null, baseline: "0", target: "100",
      direction: "increase", calculation_mode: "manual", metric_key: null, status: "active", due_at: null, created_at: time, updated_at: time, ...overrides },
    progress: { methodology: { version: 1, mode: "manual", formula: "(current-baseline)/(target-baseline)", percentDecimals: 2, rounding: "half_up", clamped: true },
      source: "manual", provenance: null, unit: "NOK", baseline: "0", target: "100", current: null, status: "insufficient_data", progressPercent: null,
      explanation: "Недостаточно данных", updatedAt: time, measurementCount: 0 },
  };
}
const empty = () => ({ domains: DOMAIN_KEYS.map((key) => ({ key, activeCount: 0, archivedCount: 0, goals: [] as unknown[] })), today: { dueGoals: [] as unknown[] }, activity: [] as unknown[],
  examples: { goals: 0, measurements: 0 }, focus_domains: [] as string[] });
function action(type: string, occurredAt = time, measurement: unknown = null) {
  return { id: uuid(), type, occurredAt, source: "web", domainKey: "finance", goal: { id: uuid(), title: "Savings", status: "active" }, measurement, example: false };
}

describe("dashboard contract", () => {
  it("accepts six empty spheres in registry order without any percentage", () => {
    expect(dashboardSchema.parse(empty())).toEqual(empty());
    expect(JSON.stringify(dashboardSchema.parse(empty()))).not.toMatch(/percent|score/i);
  });
  it.each([
    ["five spheres", (value: ReturnType<typeof empty>) => { value.domains.pop(); }],
    ["a different order", (value: ReturnType<typeof empty>) => { value.domains.reverse(); }],
    ["a seventh key", (value: ReturnType<typeof empty>) => { value.domains[0]!.key = "career" as never; }],
    ["a user id field", (value: ReturnType<typeof empty>) => { Object.assign(value, { user_id: "other" }); }],
  ])("rejects %s", (_, change) => {
    const value = empty(); change(value);
    expect(dashboardSchema.safeParse(value).success).toBe(false);
  });
  it("bounds sphere goals and keeps them active, in their sphere and within the exact count", () => {
    const value = empty();
    const finance = value.domains[1]!;
    finance.activeCount = 6; finance.goals = Array.from({ length: DASHBOARD_GOALS_PER_DOMAIN }, () => details());
    expect(dashboardSchema.safeParse(value).success).toBe(true);
    finance.goals.push(details());
    expect(dashboardSchema.safeParse(value).success).toBe(false);
    for (const [goals, activeCount] of [[[details({ domain_key: "health" })], 1], [[details({ status: "archived" })], 1], [[details()], 0]] as const) {
      finance.goals = [...goals]; finance.activeCount = activeCount;
      expect(dashboardSchema.safeParse(value).success).toBe(false);
    }
  });
  it("requires deadlines of active goals in ascending order", () => {
    const value = empty();
    value.today.dueGoals = [details({ due_at: "2026-11-01T10:00:00Z" }), details({ due_at: "2026-12-01T10:00:00Z" })];
    expect(dashboardSchema.safeParse(value).success).toBe(true);
    value.today.dueGoals.reverse();
    expect(dashboardSchema.safeParse(value).success).toBe(false);
    value.today.dueGoals = [details()];
    expect(dashboardSchema.safeParse(value).success).toBe(false);
  });
  it("normalizes activity: measurement facts carry a value, goal facts do not, newest first and bounded", () => {
    const value = empty();
    const measurement = { value: "12000", unit: "NOK", unitLabel: null };
    value.activity = [action("goal_measurement.created", "2026-11-16T10:00:00Z", measurement), action("goal.created")];
    expect(dashboardSchema.safeParse(value).success).toBe(true);
    for (const activity of [[action("goal.created", time, measurement)], [action("goal_measurement.updated")],
      [action("goal.created"), action("goal.updated", "2026-11-16T10:00:00Z")], [{ ...action("goal.created"), user_id: "other" }],
      [action("goal.deleted")], Array.from({ length: DASHBOARD_ACTIVITY_LIMIT + 1 }, () => action("goal.created"))]) {
      value.activity = activity;
      expect(dashboardSchema.safeParse(value).success).toBe(false);
    }
  });
  it("wraps the read model in the common API envelope", () => {
    const meta = { request_id: uuid(), correlation_id: uuid() };
    expect(dashboardResponseSchema.safeParse({ data: empty(), meta, errors: [] }).success).toBe(true);
  });
});
