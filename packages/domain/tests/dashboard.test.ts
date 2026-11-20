import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { activityEventDraftSchema, activityEventMetadataSchema, dashboardSchema, goalMeasurementSchema, goalSchema } from "@lifeos/contracts";
import type { ActivityEvent, DomainKey, Goal } from "@lifeos/contracts";
import { actorFromVerifiedSession, createDashboardReader, createGoalsReader, DASHBOARD_LIMITS, LIFE_DOMAINS, NotFoundError } from "../src/index.ts";
import type { DashboardActivityRecord, DashboardReadRecord, DashboardReadRepository, GoalReadRecord } from "../src/index.ts";

const actor = actorFromVerifiedSession("owner");
const other = actorFromVerifiedSession("other");
function goal(overrides: Partial<Record<keyof Goal, unknown>> = {}): Goal {
  return goalSchema.parse({ id: randomUUID(), user_id: actor.userId, title: "Goal", domain_key: "finance", unit: "NOK", baseline: "0", target: "100",
    direction: "increase", status: "active", created_at: "2026-11-15T10:00:00Z", updated_at: "2026-11-15T10:00:00Z", ...overrides });
}
function record(value: Goal, current?: string): GoalReadRecord {
  const latest = current === undefined ? null : goalMeasurementSchema.parse({ id: randomUUID(), goal_id: value.id, user_id: value.user_id, value: current,
    unit: value.unit, measured_at: "2026-11-16T10:00:00Z", source: "manual", note: null, created_at: "2026-11-16T10:00:00Z", updated_at: "2026-11-16T10:00:00Z" });
  return { goal: value, latest, measurementCount: latest ? 1 : 0, updatedAt: latest?.updated_at ?? value.updated_at };
}
function event(value: Goal, type: "goal.created" | "goal_measurement.created" | "goal_measurement.deleted", occurredAt: string, userId = value.user_id): ActivityEvent {
  const snapshot = { value: "40", measured_at: "2026-11-16T10:00:00Z", source: "manual" };
  const payload = type === "goal.created"
    ? { before: null, after: { unit: value.unit, baseline: value.baseline, target: value.target, direction: value.direction, status: "active", due_at: null } }
    : type === "goal_measurement.created" ? { before: null, after: snapshot } : { before: { ...snapshot, value: "35" }, after: null };
  const draft = activityEventDraftSchema.parse({ goal_id: value.id, domain_key: value.domain_key, target_id: type === "goal.created" ? value.id : randomUUID(),
    target_type: type === "goal.created" ? "goal" : "goal_measurement", event_type: type, schema_version: 1, payload });
  return { ...draft, ...activityEventMetadataSchema.parse({ id: randomUUID(), user_id: userId, source: "web", idempotency_key: null, occurred_at: occurredAt, created_at: occurredAt }) };
}
function activity(value: Goal, type: Parameters<typeof event>[1], occurredAt: string, userId?: string): DashboardActivityRecord {
  return { event: event(value, type, occurredAt, userId), goal: value };
}
function reader(data: Partial<DashboardReadRecord>) {
  const repository: DashboardReadRepository = { read: vi.fn(async () => ({ counts: [], domainGoals: [], dueGoals: [], activity: [], exampleMeasurements: 0, ...data })) };
  return { repository, service: createDashboardReader(repository) };
}

describe("dashboard of the six registry spheres", () => {
  it("always returns all six spheres in registry order, empty ones without counts, goals or percentages", async () => {
    const { service, repository } = reader({});
    const dashboard = await service.get(actor);
    expect(dashboard.domains.map((domain) => domain.key)).toEqual(LIFE_DOMAINS.map((domain) => domain.key));
    for (const domain of dashboard.domains) expect(domain).toEqual({ key: domain.key, activeCount: 0, archivedCount: 0, goals: [] });
    expect(dashboard.today.dueGoals).toEqual([]); expect(dashboard.activity).toEqual([]);
    expect(dashboardSchema.parse(dashboard)).toEqual(dashboard);
    expect(repository.read).toHaveBeenCalledExactlyOnceWith(actor, DASHBOARD_LIMITS);
  });

  it("uses exact counts and the same GoalDetails as the goal page, newest first and bounded per sphere", async () => {
    const goals = Array.from({ length: 6 }, (_, index) => goal({ title: `Goal ${index}`, created_at: `2026-11-1${index}T10:00:00Z` }));
    const measured = record(goals[5]!, "25");
    const { service } = reader({
      counts: [{ domainKey: "finance", status: "active", origin: "manual", total: 7 }, { domainKey: "finance", status: "archived", origin: "manual", total: 2 }, { domainKey: "health", status: "archived", origin: "manual", total: 1 }],
      domainGoals: [...goals.slice(0, 5).map((value) => record(value)), measured],
    });
    const dashboard = await service.get(actor);
    const finance = dashboard.domains.find((domain) => domain.key === "finance")!;
    expect(finance).toMatchObject({ activeCount: 7, archivedCount: 2 });
    expect(finance.goals.map(({ goal }) => goal.title)).toEqual(["Goal 5", "Goal 4", "Goal 3", "Goal 2", "Goal 1"]);
    const detail = await createGoalsReader({ find: async () => measured, list: async () => [], history: async () => null }).get(actor, measured.goal.id);
    expect(finance.goals[0]).toEqual(detail);
    expect(finance.goals[0]!.progress).toMatchObject({ current: "25", progressPercent: 25, status: "measured" });
    expect(dashboard.domains.find((domain) => domain.key === "health")).toEqual({ key: "health", activeCount: 0, archivedCount: 1, goals: [] });
    expect(dashboardSchema.safeParse(dashboard).success).toBe(true);
  });

  it("lists only active deadlines, nearest first, including overdue ones", async () => {
    const later = goal({ due_at: "2026-12-01T10:00:00Z" });
    const overdue = goal({ due_at: "2026-11-01T10:00:00Z", domain_key: "health" });
    const archived = goal({ due_at: "2026-11-05T10:00:00Z", status: "archived" });
    const { service } = reader({ dueGoals: [later, overdue, archived].map((value) => record(value)) });
    const dashboard = await service.get(actor);
    expect(dashboard.today.dueGoals.map(({ goal }) => goal.id)).toEqual([overdue.id, later.id]);
    expect(dashboardSchema.safeParse(dashboard).success).toBe(true);
  });

  it("normalizes newest audit facts and hides facts that do not belong to the actor", async () => {
    const owned = goal({ title: "Savings" });
    const foreign = goal({ user_id: other.userId, title: "Other private goal" });
    const { service } = reader({ activity: [
      activity(owned, "goal.created", "2026-11-15T10:00:00Z"),
      activity(owned, "goal_measurement.deleted", "2026-11-17T10:00:00Z"),
      activity(owned, "goal_measurement.created", "2026-11-16T10:00:00Z"),
      activity(foreign, "goal.created", "2026-11-18T10:00:00Z"),
      activity(owned, "goal.created", "2026-11-18T11:00:00Z", other.userId),
      { event: event(owned, "goal.created", "2026-11-18T12:00:00Z"), goal: { ...owned, id: randomUUID() } },
    ] });
    const dashboard = await service.get(actor);
    expect(dashboard.activity.map((item) => [item.type, item.measurement?.value ?? null])).toEqual([
      ["goal_measurement.deleted", "35"], ["goal_measurement.created", "40"], ["goal.created", null],
    ]);
    expect(dashboard.activity[0]).toMatchObject({ source: "web", domainKey: "finance", goal: { id: owned.id, title: "Savings", status: "active" },
      measurement: { value: "35", unit: "NOK", unitLabel: null } });
    expect(JSON.stringify(dashboard)).not.toContain("Other private goal");
    expect(dashboardSchema.safeParse(dashboard).success).toBe(true);
  });

  it("rejects a foreign goal row from a broken adapter instead of showing it", async () => {
    const { service } = reader({ domainGoals: [record(goal({ user_id: other.userId }))] });
    await expect(service.get(actor)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("keeps archived goals out of sphere lists even if an adapter returns them", async () => {
    const { service } = reader({ counts: [{ domainKey: "work" as DomainKey, status: "archived", origin: "manual", total: 1 }],
      domainGoals: [record(goal({ domain_key: "work", status: "archived" }))] });
    expect((await service.get(actor)).domains.find((domain) => domain.key === "work")?.goals).toEqual([]);
  });
});

describe("example banner counts (LFS-218)", () => {
  it("counts example goals of every sphere and status from the grouped counts, and example values from the snapshot", async () => {
    const { service } = reader({
      counts: [{ domainKey: "finance", status: "active", origin: "starter", total: 1 }, { domainKey: "health", status: "active", origin: "starter", total: 2 },
        { domainKey: "health", status: "archived", origin: "starter", total: 1 }, { domainKey: "health", status: "active", origin: "manual", total: 3 },
        { domainKey: "work", status: "active", origin: "onboarding", total: 1 }],
      exampleMeasurements: 3,
    });
    const dashboard = dashboardSchema.parse(await service.get(actor));
    expect(dashboard.examples).toEqual({ goals: 4, measurements: 3 });
    expect(dashboard.domains.find((domain) => domain.key === "health")).toMatchObject({ activeCount: 5, archivedCount: 1 });
  });
  it("reports no examples for an ordinary account", async () => {
    expect((await reader({}).service.get(actor)).examples).toEqual({ goals: 0, measurements: 0 });
  });
});
