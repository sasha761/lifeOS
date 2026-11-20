import { DASHBOARD_ACTIVITY_LIMIT, DASHBOARD_DUE_GOALS_LIMIT, DASHBOARD_GOALS_PER_DOMAIN } from "@lifeos/contracts";
import type { Dashboard, DomainKey, Goal, GoalDetails } from "@lifeos/contracts";
import { isVisibleActivity, newestActivityFirst, toDashboardActivity } from "./activity.ts";
import type { ActivityRecord } from "./activity.ts";
import type { Actor } from "./actor.ts";
import { LIFE_DOMAINS } from "./domains.ts";
import { goalDetailsFromRecord } from "./goals-reader.ts";
import type { GoalReadRecord } from "./goals-reader.ts";

export type DashboardLimits = { goalsPerDomain: number; dueGoals: number; activity: number };
/** Goal counts per sphere, status and origin (the origin feeds the example banner, LFS-218). */
export type DashboardCountRecord = { domainKey: DomainKey; status: Goal["status"]; origin: Goal["origin"]; total: number };
/** Same record as the activity journal (LFS-213): an owned event with its current goal row. */
export type DashboardActivityRecord = ActivityRecord;
export type DashboardReadRecord = {
  counts: DashboardCountRecord[];
  /** At most `goalsPerDomain` newest active goals of each sphere. */
  domainGoals: GoalReadRecord[];
  /** At most `dueGoals` active goals with a deadline, nearest first. */
  dueGoals: GoalReadRecord[];
  /** At most `activity` newest owned events. */
  activity: DashboardActivityRecord[];
  /** The owner's example measurements (`source = example`), counted in the same snapshot. */
  exampleMeasurements: number;
  /** «Сферы в фокусе» from the onboarding wizard (LFS-219); null when not chosen. */
  focusDomains: readonly string[] | null;
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

/**
 * Dashboard of the six registry spheres. Every number comes from owned rows: goal counts, the same
 * GoalDetails progress as the goal page and the audit log. Empty spheres stay empty: no 0% or score.
 */
export function createDashboardReader(repository: DashboardReadRepository, limits: DashboardLimits = DASHBOARD_LIMITS): DashboardReader {
  return {
    async get(actor) {
      const record = await repository.read(actor, limits);
      const counts = new Map<string, number>();
      let exampleGoals = 0;
      for (const row of record.counts) {
        counts.set(`${row.domainKey}:${row.status}`, (counts.get(`${row.domainKey}:${row.status}`) ?? 0) + count(row.total));
        if (row.origin === "starter") exampleGoals += count(row.total);
      }
      // Ownership of goals is re-checked here (NotFound on a foreign row), exactly as in GoalsReader.
      const domainGoals = record.domainGoals.map((item) => goalDetailsFromRecord(actor, item)).filter(({ goal }) => goal.status === "active");
      const dueGoals = record.dueGoals.map((item) => goalDetailsFromRecord(actor, item))
        .filter(({ goal }) => goal.status === "active" && goal.due_at !== null).sort(nearestFirst).slice(0, limits.dueGoals);
      const activity = record.activity.filter((item) => isVisibleActivity(actor, item)).map(toDashboardActivity)
        .sort(newestActivityFirst).slice(0, limits.activity);
      return {
        domains: LIFE_DOMAINS.map(({ key }) => ({
          key,
          activeCount: counts.get(`${key}:active`) ?? 0,
          archivedCount: counts.get(`${key}:archived`) ?? 0,
          goals: domainGoals.filter(({ goal }) => goal.domain_key === key).sort(newestFirst).slice(0, limits.goalsPerDomain),
        })),
        today: { dueGoals },
        activity,
        examples: { goals: exampleGoals, measurements: count(record.exampleMeasurements) },
        // Registry order, registry keys only: the stored array is ordered by the wizard and checked by SQL.
        focus_domains: LIFE_DOMAINS.map(({ key }) => key).filter((key) => record.focusDomains?.includes(key) ?? false),
      };
    },
  };
}
