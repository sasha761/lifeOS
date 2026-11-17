import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DOMAIN_KEYS, domainKeySchema } from "../src/index.ts";
import type { DomainKey } from "../src/index.ts";

describe("LifeOS domain keys", () => {
  it("accepts exactly the six stable identifiers used by UI and API input", () => {
    expect(DOMAIN_KEYS).toEqual(["languages", "finance", "work", "projects", "skills", "health"]);
    expect(domainKeySchema.options).toEqual(DOMAIN_KEYS);
    for (const key of DOMAIN_KEYS) expect(domainKeySchema.parse(key)).toBe(key);
    const valid: DomainKey = "finance";
    // @ts-expect-error Adding an arbitrary sphere requires a change to the shared registry keys.
    const invalid: DomainKey = "seventh";
    expect(valid).toBe("finance");
    expect(domainKeySchema.safeParse(invalid).success).toBe(false);
  });

  it.each([
    "seventh", "Languages", "LANGUAGES", " languages", "languages ", "", "language", "__proto__",
    "constructor", "toString", "languages/finance", "../finance", null, undefined, 1, {}, ["finance"],
  ])("rejects unknown or non-exact input %j", (input) => {
    expect(domainKeySchema.safeParse(input).success).toBe(false);
  });

  it("can validate a future domain_key field without accepting a seventh sphere", () => {
    const input = z.strictObject({ domain_key: domainKeySchema });
    expect(input.parse({ domain_key: "health" })).toEqual({ domain_key: "health" });
    expect(input.safeParse({ domain_key: "seventh" }).success).toBe(false);
    expect(Object.isFrozen(DOMAIN_KEYS)).toBe(true);
    expect(() => (DOMAIN_KEYS as unknown as string[]).push("seventh")).toThrow(TypeError);
  });
});
