import { DASHBOARD_ACTIVITY_LIMIT, DASHBOARD_DUE_GOALS_LIMIT, DASHBOARD_GOALS_PER_DOMAIN } from "@lifeos/contracts";
import type { ActivityEvent, Dashboard, DashboardActivity, DomainKey, Goal, GoalDetails } from "@lifeos/contracts";
import type { Actor } from "./actor.ts";
import { LIFE_DOMAINS } from "./domains.ts";
import { goalDetailsFromRecord } from "./goals-reader.ts";
import type { GoalReadRecord } from "./goals-reader.ts";

export type DashboardLimits = { goalsPerDomain: number; dueGoals: number; activity: number };
export type DashboardCountRecord = { domainKey: DomainKey; status: Goal["status"]; total: number };
export type DashboardActivityRecord = {
  event: ActivityEvent;
  /** Current owned goal row the event belongs to; titles are never copied into the audit log. */
  goal: Pick<Goal, "id" | "user_id" | "domain_key" | "title" | "status" | "unit" | "unit_label">;
};
export type DashboardReadRecord = {
  counts: DashboardCountRecord[];
  /** At most `goalsPerDomain` newest active goals of each sphere. */
  domainGoals: GoalReadRecord[];
  /** At most `dueGoals` active goals with a deadline, nearest first. */
  dueGoals: GoalReadRecord[];
  /** At most `activity` newest owned events. */
  activity: DashboardActivityRecord[];
};
/** One consistent read snapshot with a fixed number of owner-scoped queries (no query per goal). */
export type DashboardReadRepository = { read(actor: Actor, limits: DashboardLimits): Promise<DashboardReadRecord> };
export type DashboardReader = { get(actor: Actor): Promise<Dashboard> };

export const DASHBOARD_LIMITS: DashboardLimits = Object.freeze({
  goalsPerDomain: DASHBOARD_GOALS_PER_DOMAIN, dueGoals: DASHBOARD_DUE_GOALS_LIMIT, activity: DASHBOARD_ACTIVITY_LIMIT,
});

const newestFirst = (a: GoalDetails, b: GoalDetails) => b.goal.created_at.localeCompare(a.goal.created_at) || b.goal.id.localeCompare(a.goal.id);
const nearestFirst = (a: GoalDetails, b: GoalDetails) => a.goal.due_at!.localeCompare(b.goal.due_at!) || a.goal.id.localeCompare(b.goal.id);

function count(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid goal count.");
  return value;
}

/** Facts that do not belong to the actor (or to a mismatched goal) are hidden rather than shown. */
function visible(actor: Actor, { event, goal }: DashboardActivityRecord): boolean {
  return event.user_id === actor.userId && goal.user_id === actor.userId && event.goal_id === goal.id && event.domain_key === goal.domain_key;
}

function normalize({ event, goal }: DashboardActivityRecord): DashboardActivity {
  let snapshot: { value: string } | null = null;
  if (event.event_type === "goal_measurement.created" || event.event_type === "goal_measurement.updated") snapshot = event.payload.after;
  else if (event.event_type === "goal_measurement.deleted") snapshot = event.payload.before;
  const measurement = snapshot ? { value: snapshot.value, unit: goal.unit, unitLabel: goal.unit_label } : null;
  return {
    id: event.id, type: event.event_type, occurredAt: event.occurred_at, source: event.source, domainKey: event.domain_key,
    goal: { id: goal.id, title: goal.title, status: goal.status }, measurement,
  };
}

/**
 * Dashboard of the six registry spheres. Every number comes from owned rows: goal counts, the same
 * GoalDetails progress as the goal page and the audit log. Empty spheres stay empty: no 0% or score.
 */
export function createDashboardReader(repository: DashboardReadRepository, limits: DashboardLimits = DASHBOARD_LIMITS): DashboardReader {
  return {
    async get(actor) {
      const record = await repository.read(actor, limits);
      const counts = new Map<string, number>();
      for (const row of record.counts) counts.set(`${row.domainKey}:${row.status}`, (counts.get(`${row.domainKey}:${row.status}`) ?? 0) + count(row.total));
      // Ownership of goals is re-checked here (NotFound on a foreign row), exactly as in GoalsReader.
      const domainGoals = record.domainGoals.map((item) => goalDetailsFromRecord(actor, item)).filter(({ goal }) => goal.status === "active");
      const dueGoals = record.dueGoals.map((item) => goalDetailsFromRecord(actor, item))
        .filter(({ goal }) => goal.status === "active" && goal.due_at !== null).sort(nearestFirst).slice(0, limits.dueGoals);
      const activity = record.activity.filter((item) => visible(actor, item)).map(normalize)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id)).slice(0, limits.activity);
      return {
        domains: LIFE_DOMAINS.map(({ key }) => ({
          key,
          activeCount: counts.get(`${key}:active`) ?? 0,
          archivedCount: counts.get(`${key}:archived`) ?? 0,
          goals: domainGoals.filter(({ goal }) => goal.domain_key === key).sort(newestFirst).slice(0, limits.goalsPerDomain),
        })),
        today: { dueGoals },
        activity,
      };
    },
  };
}
