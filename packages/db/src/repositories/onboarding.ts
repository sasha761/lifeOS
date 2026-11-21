import { eq, sql } from "drizzle-orm";
import { ONBOARDING_START_TRANSITIONS } from "@lifeos/contracts";
import type { OnboardingOverviewRepository, OnboardingProfileRepository, OnboardingStateRecord, OnboardingStateRepository } from "@lifeos/domain";
import type { LifeosDatabase } from "../client.ts";
import { ownedBy } from "../ownership.ts";
import { user } from "../schema/auth.ts";
import { goals } from "../schema/goals.ts";
import { onboardingState } from "../schema/onboarding.ts";

type StateRow = typeof onboardingState.$inferSelect;
/** The write condition of a start choice: a completed setup is final for the popup (LFS-220). */
const notCompleted = sql`${onboardingState.status} <> 'completed'`;
function toRecord(row: StateRow): OnboardingStateRecord {
  return { user_id: row.userId, status: row.status, choice: row.choice, answers: row.answers, catalog_version: row.catalogVersion,
    completed_at: row.completedAt?.toISOString() ?? null, updated_at: row.updatedAt.toISOString() };
}

/**
 * The actor's own wizard row (LFS-219): reads filter by `user_id`, writes upsert the actor's key only. Opening the wizard
 * means the person chose it, so a saved draft or a completion records `choice = wizard`.
 */
export function createOnboardingStateRepository(database: Pick<LifeosDatabase, "select" | "insert">): OnboardingStateRepository {
  return {
    async find(actor) {
      const [row] = await database.select().from(onboardingState).where(ownedBy(onboardingState.userId, actor)).limit(1);
      return row ? toRecord(row) : null;
    },
    async saveDraft(actor, answers, catalogVersion) {
      const [row] = await database.insert(onboardingState)
        .values({ userId: actor.userId, status: "in_progress", choice: "wizard", answers, catalogVersion, updatedAt: sql`clock_timestamp()` })
        .onConflictDoUpdate({ target: onboardingState.userId, set: {
          // A repeated setup (LFS-220 opens it from Settings) keeps «Пройдена» until it is completed again.
          status: sql`CASE WHEN ${onboardingState.status} = 'completed' THEN 'completed' ELSE 'in_progress' END`,
          choice: "wizard", answers, catalogVersion, updatedAt: sql`clock_timestamp()`,
        } }).returning();
      if (!row || row.userId !== actor.userId) throw new Error("Onboarding draft upsert returned no own row.");
      return toRecord(row);
    },
    async complete(actor, answers, catalogVersion) {
      const values = { status: "completed" as const, choice: "wizard" as const, answers, catalogVersion,
        completedAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()` };
      const [row] = await database.insert(onboardingState).values({ userId: actor.userId, ...values })
        .onConflictDoUpdate({ target: onboardingState.userId, set: values }).returning();
      if (!row || row.userId !== actor.userId) throw new Error("Onboarding completion returned no own row.");
      return toRecord(row);
    },
    async choose(actor, choice, catalogVersion) {
      // One statement: the row lock of the upsert orders it with a parallel completion, so a completed setup is never
      // overwritten. The draft and its catalog version stay; a new row starts without answers.
      const values = { status: ONBOARDING_START_TRANSITIONS[choice], choice, updatedAt: sql`clock_timestamp()` };
      const [row] = await database.insert(onboardingState).values({ userId: actor.userId, catalogVersion, ...values })
        .onConflictDoUpdate({ target: onboardingState.userId, set: values, setWhere: notCompleted }).returning();
      if (row && row.userId !== actor.userId) throw new Error("Onboarding choice returned a foreign row.");
      return row ? toRecord(row) : null;
    },
    async completeWithExample(actor, catalogVersion) {
      const values = { status: "completed" as const, choice: "example" as const, completedAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()` };
      const [row] = await database.insert(onboardingState).values({ userId: actor.userId, catalogVersion, ...values })
        .onConflictDoUpdate({ target: onboardingState.userId, set: values, setWhere: notCompleted }).returning();
      if (row && row.userId !== actor.userId) throw new Error("Onboarding example returned a foreign row.");
      return row ? toRecord(row) : null;
    },
  };
}

const readSnapshot = { isolationLevel: "repeatable read", accessMode: "read only" } as const;
function count(value: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("Invalid stored goal count.");
  return result;
}

/**
 * «Начальная настройка» in Settings and the popup (LFS-220): the actor's profile row with its state row (left join: no
 * row means not started) and goal counts by origin, under one READ ONLY REPEATABLE READ snapshot. Two owner-scoped
 * queries, whatever the number of goals.
 */
export function createOnboardingOverviewRepository(database: LifeosDatabase): OnboardingOverviewRepository {
  return {
    read(actor) {
      return database.transaction(async (transaction) => {
        const [profile] = await transaction.select({ checkinRhythm: user.checkinRhythm, focusDomains: user.focusDomains, state: onboardingState })
          .from(user).leftJoin(onboardingState, eq(onboardingState.userId, user.id)).where(ownedBy(user.id, actor)).limit(1);
        if (!profile) return null;
        const origins = await transaction.select({ origin: goals.origin, total: sql<string>`count(*)::text` })
          .from(goals).where(ownedBy(goals.userId, actor)).groupBy(goals.origin);
        const by = (origin: string) => count(origins.find((row) => row.origin === origin)?.total ?? "0");
        return {
          state: profile.state ? toRecord(profile.state) : null,
          checkinRhythm: profile.checkinRhythm, focusDomains: profile.focusDomains,
          goals: { total: origins.reduce((sum, row) => sum + count(row.total), 0), onboarding: by("onboarding"), examples: by("starter") },
        };
      }, readSnapshot);
    },
  };
}

/** «Сферы в фокусе», rhythm and the confirmed zone on the actor's own `user` row; a null value keeps the stored one. */
export function createOnboardingProfileRepository(database: Pick<LifeosDatabase, "update">): OnboardingProfileRepository {
  return {
    async applyOnboarding(actor, { focusDomains, checkinRhythm, timezone }) {
      // Undefined keys are skipped by Drizzle; updated_at is bumped by the schema's $onUpdate.
      const rows = await database.update(user)
        .set({ focusDomains: focusDomains.length ? [...focusDomains] : null, checkinRhythm: checkinRhythm ?? undefined, timezone: timezone ?? undefined })
        .where(ownedBy(user.id, actor)).returning({ id: user.id });
      return rows.length === 1;
    },
    async setCheckinRhythm(actor, rhythm) {
      const rows = await database.update(user).set({ checkinRhythm: rhythm }).where(ownedBy(user.id, actor)).returning({ id: user.id });
      return rows.length === 1;
    },
  };
}
