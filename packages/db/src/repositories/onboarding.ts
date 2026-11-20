import { sql } from "drizzle-orm";
import type { OnboardingProfileRepository, OnboardingStateRecord, OnboardingStateRepository } from "@lifeos/domain";
import type { LifeosDatabase } from "../client.ts";
import { ownedBy } from "../ownership.ts";
import { user } from "../schema/auth.ts";
import { onboardingState } from "../schema/onboarding.ts";

type StateRow = typeof onboardingState.$inferSelect;
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
  };
}
