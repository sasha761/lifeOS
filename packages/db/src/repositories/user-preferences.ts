import type { UserPreferencesRepository } from "@lifeos/domain";
import type { LifeosDatabase } from "../client.ts";
import { ownedBy } from "../ownership.ts";
import { user } from "../schema/auth.ts";

const preferenceColumns = { timezone: user.timezone, locale: user.locale };

/**
 * Preferences live on the actor's own `user` row, so ownership is `user.id = actor.userId`.
 * Writes go through the domain service, which has already validated and normalized the values.
 */
export function createUserPreferencesRepository(database: LifeosDatabase): UserPreferencesRepository {
  return {
    async find(actor) {
      const [row] = await database.select(preferenceColumns).from(user).where(ownedBy(user.id, actor)).limit(1);
      return row ?? null;
    },
    async update(actor, changes) {
      // Undefined keys are skipped by Drizzle; updated_at is bumped by the schema's $onUpdate (UTC).
      const [row] = await database.update(user)
        .set({ timezone: changes.timezone, locale: changes.locale })
        .where(ownedBy(user.id, actor))
        .returning(preferenceColumns);
      return row ?? null;
    },
  };
}
