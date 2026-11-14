import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createDemoPayload, ERROR_MESSAGES, errorCodeSchema, healthDataSchema, healthResponseSchema, HTTP_HEADERS } from "@lifeos/contracts";
import { GET } from "../app/api/health/route.ts";
import { ApiError, mapApiError } from "../server/api-error.ts";
import { apiRoute, parseJsonBody, writeHttpLog } from "../server/api-route.ts";

afterEach(() => vi.restoreAllMocks());
const url = "http://localhost/api/isolated-test?token=do-not-log";
const health = () => ({ status: "ok" as const, service: "lifeos-web" as const, timestamp: new Date().toISOString() });

describe("HTTP boundary", () => {
  it("serves the real health route with a typed envelope and matching IDs in headers and logs", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const response = await GET(new Request(url));
    const body = healthResponseSchema.parse(await response.json());
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ status: "ok", service: "lifeos-web" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get(HTTP_HEADERS.requestId)).toBe(body.meta.request_id);
    expect(response.headers.get(HTTP_HEADERS.correlationId)).toBe(body.meta.correlation_id);
    expect(body.meta.request_id).toBe(body.meta.correlation_id);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ ...body.meta, event: "http.request", status: 200 });
    expect(JSON.stringify(log.mock.calls)).not.toContain("do-not-log");
  });
  it("keeps a valid correlation ID for a future job and generates a fresh server request ID", async () => {
    const correlationId = "af347ed1-1e17-4bee-8305-579207023b03";
    const log = vi.fn();
    const handle = apiRoute(healthDataSchema, (_request, context) => {
      expect(createDemoPayload("ok", context)).toEqual({ requestId: context.request_id, correlationId, mode: "ok" });
      return health();
    }, log);
    const request = () => new Request(url, { headers: { [HTTP_HEADERS.correlationId]: correlationId, [HTTP_HEADERS.requestId]: correlationId } });
    const first = healthResponseSchema.parse(await (await handle(request())).json());
    const second = healthResponseSchema.parse(await (await handle(request())).json());
    expect(first.meta.correlation_id).toBe(correlationId);
    expect(first.meta.request_id).not.toBe(correlationId);
    expect(first.meta.request_id).not.toBe(second.meta.request_id);
  });
  it("replaces untrusted correlation values without logging them", async () => {
    const log = vi.fn();
    const response = await apiRoute(healthDataSchema, health, log)(new Request(url, { headers: { [HTTP_HEADERS.correlationId]: "do-not-log" } }));
    const body = healthResponseSchema.parse(await response.json());
    expect(body.meta.correlation_id).toBe(body.meta.request_id);
    expect(JSON.stringify(log.mock.calls)).not.toContain("do-not-log");
  });
  it.each(["{broken do-not-log", JSON.stringify({ count: "do-not-log", "private_table": 1 })])("returns safe 400 for malformed JSON or DTO %# in an isolated handler", async (body) => {
    const log = vi.fn();
    const response = await apiRoute(healthDataSchema, async (request) => {
      await parseJsonBody(request, z.strictObject({ count: z.number().int().positive() }));
      return health();
    }, log)(new Request(url, { method: "POST", body }));
    expect(response.status).toBe(400);
    const result = healthResponseSchema.parse(await response.json());
    expect(result).toMatchObject({ data: null, errors: [{ code: "VALIDATION_ERROR", message: "Invalid request." }] });
    expect(response.headers.get(HTTP_HEADERS.requestId)).toBe(result.meta.request_id);
    expect(JSON.stringify([result, log.mock.calls])).not.toMatch(/do-not-log|private_table|stack/);
  });
  it("accepts a validated JSON DTO", async () => {
    await expect(parseJsonBody(new Request(url, { method: "POST", body: '{"count":1}' }), z.strictObject({ count: z.number() }))).resolves.toEqual({ count: 1 });
  });
  it.each([new ApiError("NOT_FOUND"), new Error("private_table do-not-log postgres://secret"), "private_table"])("maps known and unexpected handler errors safely %#", async (error) => {
    const log = vi.fn();
    const response = await apiRoute(healthDataSchema, () => { throw error; }, log)(new Request(url));
    expect(response.status).toBe(error instanceof ApiError ? 404 : 500);
    const result = healthResponseSchema.parse(await response.json());
    expect(result.data).toBeNull();
    expect(JSON.stringify([result, log.mock.calls])).not.toMatch(/private_table|do-not-log|stack|secret/);
    expect(response.headers.get(HTTP_HEADERS.correlationId)).toBe(result.meta.correlation_id);
  });
  it("treats invalid server output as 500 without exposing validation details", async () => {
    const response = await apiRoute(z.string(), () => 42 as unknown as string, vi.fn())(new Request(url));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ errors: [{ code: "INTERNAL_ERROR", message: "Internal server error." }] });
  });
  it("writes only the allowed HTTP log fields", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const event = { event: "http.request" as const, status: 500, request_id: "a", correlation_id: "b", password: "do-not-log", stack: "private_table" };
    writeHttpLog(event);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({ event: "http.request", status: 500, request_id: "a", correlation_id: "b" });
  });
});

describe("error mapping", () => {
  const statuses = [400, 401, 403, 404, 429, 409, 500, 503, 429];
  it.each(errorCodeSchema.options.map((code, index) => ({ code, status: statuses[index] })))("maps $code to $status", ({ code, status }) => {
    expect(mapApiError(new ApiError(code))).toEqual({ status, error: { code, message: ERROR_MESSAGES[code] } });
  });
  it("does not trust arbitrary Error messages", () => {
    expect(mapApiError(new Error("private_table"))).toEqual({ status: 500, error: { code: "INTERNAL_ERROR", message: "Internal server error." } });
  });
});
