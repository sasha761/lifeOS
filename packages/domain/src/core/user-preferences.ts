import { updateUserPreferencesInputSchema } from "@lifeos/contracts";
import type { UpdateUserPreferencesInput, UserPreferences } from "@lifeos/contracts";
import type { Actor } from "./actor.ts";
import { InvalidInputError } from "./errors.ts";
import { requireFound } from "./ownership.ts";

/**
 * Defaults for new and migrated users; the SQL defaults of `user.timezone`/`user.locale` must match
 * (checked by the Web integration tests). UTC claims no location; "ru" is the language of the UI.
 */
export const DEFAULT_USER_PREFERENCES = Object.freeze({ timezone: "UTC", locale: "ru" }) satisfies UserPreferences;

/** Persistence port. Implementations read and write only the actor's own row. */
export type UserPreferencesRepository = {
  find(actor: Actor): Promise<UserPreferences | null>;
  update(actor: Actor, changes: UpdateUserPreferencesInput): Promise<UserPreferences | null>;
};

export type UserPreferencesService = {
  get(actor: Actor): Promise<UserPreferences>;
  /** Validates untrusted input itself, so every caller (HTTP, future bots or tools) gets the same rules. */
  update(actor: Actor, input: unknown): Promise<UserPreferences>;
};

export function createUserPreferencesService(repository: UserPreferencesRepository): UserPreferencesService {
  return {
    async get(actor) {
      return requireFound(await repository.find(actor));
    },
    async update(actor, input) {
      const parsed = updateUserPreferencesInputSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError();
      return requireFound(await repository.update(actor, parsed.data));
    },
  };
}
