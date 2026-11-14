import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  apiFailureSchema, apiSuccessSchema, createDemoPayload, demoPingPayloadSchema, errorCodeSchema,
  healthResponseSchema, idempotencyKeySchema, requestContextSchema,
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
