import { describe, expect, it } from "vitest";
import { formatDateTime, utcOffsetLabel } from "../lib/user-preferences.ts";

describe("measurement instant presentation for the future goals UI", () => {
  it("formats UTC measurements in the user's IANA zone across the daylight-saving boundary", () => {
    const preferences = { timezone: "Europe/Oslo", locale: "en-GB" };
    const before = new Date("2026-03-29T00:30:00.000Z");
    const after = new Date("2026-03-29T01:30:00.000Z");
    expect(formatDateTime(before, preferences)).toContain("01:30");
    expect(formatDateTime(after, preferences)).toContain("03:30");
    expect(utcOffsetLabel(before, preferences.timezone)).toBe("UTC+01:00");
    expect(utcOffsetLabel(after, preferences.timezone)).toBe("UTC+02:00");
    expect(before.toISOString()).toBe("2026-03-29T00:30:00.000Z");
  });
  it("falls back to UTC when a previously stored zone becomes unavailable", () => {
    const instant = new Date("2026-03-29T01:30:00.000Z");
    expect(formatDateTime(instant, { timezone: "Unknown/Zone", locale: "en-GB" })).toBe(formatDateTime(instant, { timezone: "UTC", locale: "ru" }));
  });
});
