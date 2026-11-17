import { describe, expect, it } from "vitest";
import { createSignupPolicy, normalizeEmail } from "../src/index.ts";

describe("closed registration policy", () => {
  it("matches allowlisted emails case-insensitively after trimming", () => {
    const policy = createSignupPolicy([" Owner@Example.COM ", "second@example.org"]);
    expect(policy.size).toBe(2);
    for (const email of ["owner@example.com", "  OWNER@example.com", "Second@Example.org "]) expect(policy.isAllowed(email)).toBe(true);
  });
  it("rejects addresses outside the list, near-misses and empty input", () => {
    const policy = createSignupPolicy(["owner@example.com"]);
    for (const email of ["intruder@example.com", "owner@example.co", "owner@example.com.evil.test", "", "   "]) {
      expect(policy.isAllowed(email)).toBe(false);
    }
  });
  it("is closed when the allowlist is empty or contains only blanks", () => {
    for (const list of [[], ["", "  "]]) {
      const policy = createSignupPolicy(list);
      expect(policy.size).toBe(0);
      expect(policy.isAllowed("owner@example.com")).toBe(false);
    }
  });
  it("deduplicates normalized entries", () => {
    expect(createSignupPolicy(["a@example.com", "A@EXAMPLE.COM ", "a@example.com"]).size).toBe(1);
    expect(normalizeEmail("  MiXeD@Example.Com ")).toBe("mixed@example.com");
  });
});
