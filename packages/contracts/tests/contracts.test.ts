import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  apiFailureSchema, apiSuccessSchema, createDemoPayload, currentUserResponseSchema, demoPingPayloadSchema, errorCodeSchema,
  healthResponseSchema, idempotencyKeySchema, passwordResetInputSchema, passwordResetRequestSchema, PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH, requestContextSchema, signInInputSchema, signUpInputSchema,
  LOCALE_MAX_LENGTH, localeSchema, normalizeLocale, normalizeTimeZone, supportedTimeZones, timeZoneSchema,
  updateUserPreferencesInputSchema, userPreferencesResponseSchema,
} from "../src/index.ts";

const meta = { request_id: "b8b9546b-496f-4bc3-903d-0328f3cb67ac", correlation_id: "af347ed1-1e17-4bee-8305-579207023b03" };
const data = { status: "ok", service: "lifeos-web", timestamp: "2026-11-12T12:00:00.000Z" };

describe("API envelopes", () => {
  it("requires non-null data on success even for an unknown DTO schema", () => {
    for (const data of [null, undefined]) expect(apiSuccessSchema(z.unknown()).safeParse({ data, meta, errors: [] }).success).toBe(false);
  });
  it("accepts success and failure in the same contract", () => {
    expect(healthResponseSchema.parse({ data, meta, errors: [] }).data).toEqual(data);
    expect(healthResponseSchema.parse({ data: null, meta, errors: [{ code: "NOT_FOUND", message: "Resource not found." }] }).data).toBeNull();
    expect(errorCodeSchema.options).toHaveLength(9);
  });
  it.each([
    { data, meta, errors: [{ code: "INTERNAL_ERROR", message: "failure" }] },
    { data: null, meta, errors: [] },
    { data: { ...data, timestamp: "invalid" }, meta, errors: [] },
    { data, meta: { ...meta, request_id: "invalid" }, errors: [] },
    { data, meta, errors: [], stack: "private" },
  ])("rejects inconsistent envelopes and malformed DTOs %#", (value) => {
    expect(healthResponseSchema.safeParse(value).success).toBe(false);
  });
  it("rejects unsupported error codes and extra error fields", () => {
    expect(apiFailureSchema.safeParse({ data: null, meta, errors: [{ code: "SQL_ERROR", message: "failure" }] }).success).toBe(false);
    expect(apiFailureSchema.safeParse({ data: null, meta, errors: [{ code: "INTERNAL_ERROR", message: "failure", stack: "private" }] }).success).toBe(false);
  });
});

describe("transport and job metadata", () => {
  it("rejects UUID-shaped trace IDs with invalid RFC version or variant at the wire boundary", () => {
    for (const id of ["af347ed1-1e17-9bee-8305-579207023b03", "af347ed1-1e17-4bee-0305-579207023b03"]) {
      expect(requestContextSchema.safeParse({ ...meta, correlation_id: id }).success).toBe(false);
      expect(demoPingPayloadSchema.safeParse({ correlationId: id, mode: "ok" }).success).toBe(false);
    }
  });
  it("passes context to a job without generating more IDs", () => {
    expect(createDemoPayload("ok", requestContextSchema.parse(meta))).toEqual({
      requestId: meta.request_id, correlationId: meta.correlation_id, mode: "ok",
    });
  });
  it("rejects unknown job input and invalid identifiers", () => {
    expect(demoPingPayloadSchema.safeParse({ correlationId: meta.correlation_id, requestId: "secret", mode: "ok" }).success).toBe(false);
    expect(demoPingPayloadSchema.safeParse({ correlationId: meta.correlation_id, mode: "ok", secret: "private" }).success).toBe(false);
  });
  it("defines bounded opaque idempotency keys", () => {
    expect(idempotencyKeySchema.parse("operation:123_v1.0-test")).toBe("operation:123_v1.0-test");
    for (const key of ["", "a".repeat(129), "invalid key", "line\nbreak", "trailing\n"]) expect(idempotencyKeySchema.safeParse(key).success).toBe(false);
  });
});

describe("auth DTOs", () => {
  const password = "correct horse battery";
  it("normalizes surrounding whitespace in emails and names but keeps passwords verbatim", () => {
    expect(signUpInputSchema.parse({ name: "  Alex ", email: "  Alex@Example.COM ", password: ` ${password} ` })).toEqual({
      name: "Alex", email: "Alex@Example.COM", password: ` ${password} `,
    });
  });
  it.each([
    { name: "", email: "a@example.com", password },
    { name: "Alex", email: "not-an-email", password },
    { name: "Alex", email: "a@example.com", password: "x".repeat(PASSWORD_MIN_LENGTH - 1) },
    { name: "Alex", email: "a@example.com", password: "x".repeat(PASSWORD_MAX_LENGTH + 1) },
    { name: "Alex", email: "a@example.com", password, userId: "attacker-controlled" },
  ])("rejects invalid sign-up input and unknown fields %#", (value) => {
    expect(signUpInputSchema.safeParse(value).success).toBe(false);
  });
  it("lets the server decide on existing passwords but still bounds sign-in input", () => {
    expect(signInInputSchema.safeParse({ email: "a@example.com", password: "short" }).success).toBe(true);
    expect(signInInputSchema.safeParse({ email: "a@example.com", password: "" }).success).toBe(false);
    expect(signInInputSchema.safeParse({ email: "a@example.com", password: "x".repeat(PASSWORD_MAX_LENGTH + 1) }).success).toBe(false);
  });
  it("accepts only opaque URL-safe reset tokens and a valid new password", () => {
    expect(passwordResetRequestSchema.safeParse({ email: "a@example.com" }).success).toBe(true);
    expect(passwordResetInputSchema.safeParse({ token: "AbC123xyz", password }).success).toBe(true);
    for (const token of ["", "has space", "a/b", "x".repeat(257)]) {
      expect(passwordResetInputSchema.safeParse({ token, password }).success).toBe(false);
    }
  });
  it("describes the current user without credentials or session tokens", () => {
    const user = { id: "user_1", email: "a@example.com", name: "Alex" };
    expect(currentUserResponseSchema.parse({ data: user, meta, errors: [] }).data).toEqual(user);
    expect(currentUserResponseSchema.safeParse({ data: { ...user, token: "secret" }, meta, errors: [] }).success).toBe(false);
    expect(currentUserResponseSchema.parse({ data: null, meta, errors: [{ code: "UNAUTHORIZED", message: "Authentication required." }] }).data).toBeNull();
  });
});

describe("user preferences (LFS-202)", () => {
  it.each([
    ["Europe/Oslo", "Europe/Oslo"],
    ["  europe/oslo ", "Europe/Oslo"],
    ["UTC", "UTC"],
    ["utc", "UTC"],
    ["Etc/GMT+5", "Etc/GMT+5"],
    ["America/Argentina/Buenos_Aires", "America/Argentina/Buenos_Aires"],
  ])("accepts the IANA time zone %j as %j", (input, expected) => {
    expect(normalizeTimeZone(input)).toBe(expected);
    expect(timeZoneSchema.parse(input)).toBe(expected);
  });

  it("keeps valid IANA names the runtime does not list instead of rewriting them to ICU aliases", () => {
    // ICU resolves "Europe/Kyiv" to the legacy "Europe/Kiev"; the user's choice is stored as given.
    expect(normalizeTimeZone("Europe/Kyiv")).toBe("Europe/Kyiv");
  });

  it.each(["", "   ", "+01:00", "-05:00", "Z", "Mars/Olympus_Mons", "Europe/../Oslo", "Europe/Oslo; DROP TABLE", `Europe/${"x".repeat(64)}`])(
    "rejects %j, which is not an IANA time zone",
    (input) => {
      expect(normalizeTimeZone(input)).toBeNull();
      expect(timeZoneSchema.safeParse(input).success).toBe(false);
    },
  );

  it("lists UTC first and only zones that the validator accepts", () => {
    const zones = supportedTimeZones();
    expect(zones[0]).toBe("UTC");
    expect(new Set(zones).size).toBe(zones.length);
    for (const zone of zones) expect(normalizeTimeZone(zone)).toBe(zone);
  });

  it.each([["ru", "ru"], ["en-us", "en-US"], [" NB-no ", "nb-NO"], ["zh-hant-tw", "zh-Hant-TW"], ["sr-Latn-RS", "sr-Latn-RS"]])(
    "accepts the BCP 47 tag %j in canonical form %j",
    (input, expected) => {
      expect(normalizeLocale(input)).toBe(expected);
      expect(localeSchema.parse(input)).toBe(expected);
    },
  );

  it.each(["", "en_US", "ru,en", "x-private", "i-klingon", "und", "zz", "123", `en-${"a".repeat(LOCALE_MAX_LENGTH)}`])(
    "rejects %j, which is malformed or cannot format dates",
    (input) => {
      expect(normalizeLocale(input)).toBeNull();
      expect(localeSchema.safeParse(input).success).toBe(false);
    },
  );

  it("accepts partial updates, rejects empty bodies and never accepts an owner identifier", () => {
    expect(updateUserPreferencesInputSchema.parse({ timezone: "europe/oslo" })).toEqual({ timezone: "Europe/Oslo" });
    expect(updateUserPreferencesInputSchema.parse({ locale: "en-gb" })).toEqual({ locale: "en-GB" });
    for (const body of [{}, { timezone: null }, { timezone: "+01:00" }, { locale: "und" }, { timezone: "UTC", userId: "someone-else" }, { timezone: "UTC", user_id: "x" }, [], "UTC"]) {
      expect(updateUserPreferencesInputSchema.safeParse(body).success).toBe(false);
    }
  });

  it("returns stored preferences in the common envelope without extra fields", () => {
    const preferences = { timezone: "Europe/Oslo", locale: "nb-NO" };
    expect(userPreferencesResponseSchema.parse({ data: preferences, meta, errors: [] }).data).toEqual(preferences);
    expect(userPreferencesResponseSchema.safeParse({ data: { ...preferences, userId: "x" }, meta, errors: [] }).success).toBe(false);
  });
});
