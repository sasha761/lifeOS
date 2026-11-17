import { describe, expect, it } from "vitest";
import type { UpdateUserPreferencesInput, UserPreferences } from "@lifeos/contracts";
import {
  actorFromVerifiedSession, createUserPreferencesService, DEFAULT_USER_PREFERENCES, DomainError, InvalidInputError, isDomainError,
  NotFoundError, requireFound, requireOwned,
} from "../src/index.ts";
import type { Actor, UserPreferencesRepository } from "../src/index.ts";

const owner = actorFromVerifiedSession("user-owner");
const other = actorFromVerifiedSession("user-other");

describe("actor", () => {
  it("is created only from a non-empty verified session user id and cannot be mutated", () => {
    expect(owner.userId).toBe("user-owner");
    expect(Object.isFrozen(owner)).toBe(true);
    for (const value of ["", "x".repeat(129), 42 as unknown as string, undefined as unknown as string]) {
      expect(() => actorFromVerifiedSession(value)).toThrow();
    }
  });

  it("is a branded type: a raw object with a userId is not an Actor", () => {
    const fromRequestBody = { userId: "user-owner" };
    // @ts-expect-error A request-derived object must never satisfy the Actor type.
    const forged: Actor = fromRequestBody;
    expect(forged.userId).toBe("user-owner");
  });
});

describe("ownership", () => {
  const record = { id: "r1", userId: owner.userId, title: "private" };

  it("returns the owner's record", () => {
    expect(requireOwned(owner, record)).toBe(record);
  });

  it("treats a foreign record exactly like a missing one", () => {
    const foreign = (() => { try { requireOwned(other, record); } catch (error) { return error; } })();
    const missing = (() => { try { requireOwned(other, null); } catch (error) { return error; } })();
    expect(foreign).toBeInstanceOf(NotFoundError);
    expect(missing).toBeInstanceOf(NotFoundError);
    expect(foreign).toMatchObject({ code: "NOT_FOUND", message: "Resource not found." });
    expect((foreign as Error).message).toBe((missing as Error).message);
    expect(JSON.stringify(foreign)).not.toContain("private");
  });

  it("recognises domain errors from another copy of the package, but not forged codes", () => {
    // Simulates a second module instance (separate Next.js bundle layer): same registry symbol, other class.
    const brand = Symbol.for("@lifeos/domain/DomainError");
    const fromOtherCopy = Object.assign(new Error("Invalid input."), { name: "InvalidInputError", code: "VALIDATION_ERROR", [brand]: true });
    expect(fromOtherCopy instanceof DomainError).toBe(false);
    expect(isDomainError(fromOtherCopy)).toBe(true);
    expect(isDomainError(new NotFoundError())).toBe(true);
    expect(isDomainError(Object.assign(new Error("x"), { code: "INTERNAL_ERROR", [brand]: true }))).toBe(false);
    expect(isDomainError(Object.assign(new Error("x"), { code: "NOT_FOUND" }))).toBe(false);
    for (const value of [null, undefined, "NOT_FOUND", { code: "NOT_FOUND" }]) expect(isDomainError(value)).toBe(false);
    // The brand is not enumerable, so serialised errors carry no extra fields.
    const error = new NotFoundError();
    expect(Object.getOwnPropertyDescriptor(error, brand)).toMatchObject({ value: true, enumerable: false });
    expect(JSON.parse(JSON.stringify(error))).toEqual({ code: "NOT_FOUND", name: "NotFoundError" });
  });

  it("requires actor-scoped records to exist", () => {
    expect(requireFound(0)).toBe(0);
    expect(() => requireFound(undefined)).toThrow(NotFoundError);
    expect(new NotFoundError()).toBeInstanceOf(DomainError);
  });
});

/** In-memory repository honouring the port contract: only the actor's own row is visible. */
function memoryRepository(rows: Map<string, UserPreferences>) {
  const calls: { actor: Actor; changes?: UpdateUserPreferencesInput }[] = [];
  const repository: UserPreferencesRepository = {
    find: async (actor) => {
      calls.push({ actor });
      return rows.get(actor.userId) ?? null;
    },
    update: async (actor, changes) => {
      calls.push({ actor, changes });
      const current = rows.get(actor.userId);
      if (!current) return null;
      const next = { ...current, ...changes };
      rows.set(actor.userId, next);
      return next;
    },
  };
  return { repository, calls };
}

describe("user preferences service", () => {
  it("uses safe defaults that pass its own validation", () => {
    expect(DEFAULT_USER_PREFERENCES).toEqual({ timezone: "UTC", locale: "ru" });
  });

  it("reads and updates only the actor's own preferences with canonical values", async () => {
    const rows = new Map([[owner.userId, { ...DEFAULT_USER_PREFERENCES }], [other.userId, { ...DEFAULT_USER_PREFERENCES }]]);
    const { repository, calls } = memoryRepository(rows);
    const service = createUserPreferencesService(repository);
    expect(await service.update(owner, { timezone: " europe/oslo ", locale: "nb-no" })).toEqual({ timezone: "Europe/Oslo", locale: "nb-NO" });
    expect(await service.get(other)).toEqual(DEFAULT_USER_PREFERENCES);
    expect(calls.map((call) => call.actor.userId)).toEqual([owner.userId, other.userId]);
    expect(calls[0]?.changes).toEqual({ timezone: "Europe/Oslo", locale: "nb-NO" });
  });

  it.each([
    [{}], [null], ["Europe/Oslo"], [{ timezone: "+01:00" }], [{ locale: "und" }],
    [{ timezone: "UTC", userId: "user-other" }],
  ])("rejects invalid input %j before touching the repository", async (input) => {
    const { repository, calls } = memoryRepository(new Map([[owner.userId, { ...DEFAULT_USER_PREFERENCES }]]));
    await expect(createUserPreferencesService(repository).update(owner, input)).rejects.toBeInstanceOf(InvalidInputError);
    expect(calls).toHaveLength(0);
  });

  it("answers NOT_FOUND when the actor's user row does not exist", async () => {
    const service = createUserPreferencesService(memoryRepository(new Map()).repository);
    await expect(service.get(owner)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.update(owner, { locale: "en-US" })).rejects.toBeInstanceOf(NotFoundError);
  });
});
