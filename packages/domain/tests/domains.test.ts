import { describe, expect, it } from "vitest";
import { DOMAIN_KEYS, domainKeySchema } from "@lifeos/contracts";
import { findLifeDomain, LIFE_DOMAINS } from "../src/index.ts";

describe("LifeOS spheres registry", () => {
  it("covers the shared keys exactly once in stable order, with unique URLs", () => {
    expect(LIFE_DOMAINS.map((domain) => domain.key)).toEqual(DOMAIN_KEYS);
    expect(new Set(LIFE_DOMAINS.map((domain) => domain.url)).size).toBe(6);
    for (const domain of LIFE_DOMAINS) {
      expect(domainKeySchema.parse(domain.key)).toBe(domain.key);
      expect(domain.url).toBe(`/domains/${domain.key}`);
      expect(findLifeDomain(domain.key)).toBe(domain);
    }
  });

  it("has localizable names and descriptions without UI components or fake metrics", () => {
    for (const domain of LIFE_DOMAINS) {
      for (const locale of ["ru", "en"] as const) {
        expect(domain.name[locale].trim().length).toBeGreaterThan(0);
        expect(domain.description[locale].trim().length).toBeGreaterThan(0);
      }
      expect(domain).not.toHaveProperty("icon");
      expect(domain).not.toHaveProperty("progress");
      expect(domain).not.toHaveProperty("balance");
      expect(domain).not.toHaveProperty("cefr");
    }
  });

  it("allows the shared manual-goal model but advertises no specialized integration", () => {
    for (const domain of LIFE_DOMAINS) {
      expect(domain.status).toBe("available");
      expect(domain.available).toBe(true);
      expect(domain.specializedAvailable).toBe(false);
    }
  });

  it.each(["seventh", "Languages", " languages", "finance ", "__proto__", "constructor", "toString", "", null, undefined, {}, ["health"]])(
    "does not resolve unknown input %j into a sphere", (input) => {
      expect(findLifeDomain(input)).toBeUndefined();
    },
  );

  it("protects keys, metadata and translations against in-process mutation", () => {
    expect(Object.isFrozen(LIFE_DOMAINS)).toBe(true);
    for (const domain of LIFE_DOMAINS) {
      expect(Reflect.set(domain, "key", "seventh")).toBe(false);
      expect(Reflect.set(domain.name, "ru", "Changed")).toBe(false);
      expect(Reflect.set(domain.description, "en", "Changed")).toBe(false);
    }
    expect(LIFE_DOMAINS.map((domain) => domain.key)).toEqual(DOMAIN_KEYS);
  });
});
