import { z } from "zod";

export const errorCodeSchema = z.enum([
  "VALIDATION_ERROR", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "RATE_LIMITED",
  "CONFLICT", "INTERNAL_ERROR", "AI_UNAVAILABLE", "BUDGET_EXCEEDED",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const ERROR_MESSAGES = {
  VALIDATION_ERROR: "Invalid request.", UNAUTHORIZED: "Authentication required.",
  FORBIDDEN: "Access denied.", NOT_FOUND: "Resource not found.",
  RATE_LIMITED: "Too many requests.", CONFLICT: "Resource conflict.",
  INTERNAL_ERROR: "Internal server error.", AI_UNAVAILABLE: "AI service unavailable.",
  BUDGET_EXCEEDED: "Budget exceeded.",
} as const satisfies Record<ErrorCode, string>;

export const HTTP_HEADERS = {
  requestId: "x-request-id", correlationId: "x-correlation-id", idempotencyKey: "idempotency-key",
} as const;
export const identifierSchema = z.uuid();
export const requestContextSchema = z.strictObject({
  request_id: identifierSchema, correlation_id: identifierSchema,
});
export type RequestContext = z.infer<typeof requestContextSchema>;
export const apiMetaSchema = requestContextSchema;
export type ApiMeta = z.infer<typeof apiMetaSchema>;
// Contract only: persistence/replay and ownership scope belong to later tasks.
export const idempotencyKeySchema = z.string().min(1).max(128).refine((value) => !/[^A-Za-z0-9._:-]/.test(value));
export const apiErrorSchema = z.strictObject({ code: errorCodeSchema, message: z.string().min(1) });
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
export const apiFailureSchema = z.strictObject({
  data: z.null(), meta: apiMetaSchema, errors: z.array(apiErrorSchema).min(1),
});
export type ApiFailure = z.infer<typeof apiFailureSchema>;

export function apiSuccessSchema<T extends z.ZodType>(dataSchema: T) {
  return z.strictObject({
    data: dataSchema.refine((value) => value !== null && value !== undefined),
    meta: apiMetaSchema, errors: z.tuple([]),
  });
}
export function apiResponseSchema<T extends z.ZodType>(dataSchema: T) {
  return z.union([apiSuccessSchema(dataSchema), apiFailureSchema]);
}
export type ApiResponse<T extends z.ZodType> = z.infer<ReturnType<typeof apiResponseSchema<T>>>;

export const healthDataSchema = z.strictObject({
  status: z.literal("ok"), service: z.literal("lifeos-web"), timestamp: z.iso.datetime(),
});
export type HealthData = z.infer<typeof healthDataSchema>;
export const healthResponseSchema = apiResponseSchema(healthDataSchema);
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const demoModeSchema = z.enum(["ok", "fail-once", "always-fail"]);
// Preserve existing demo jobs; new producers always supply requestId too.
export const demoPingPayloadSchema = z.strictObject({
  correlationId: identifierSchema, requestId: identifierSchema.optional(), mode: demoModeSchema,
});
export type DemoMode = z.infer<typeof demoModeSchema>;
export type DemoPayload = z.infer<typeof demoPingPayloadSchema>;
export function createDemoPayload(mode: DemoMode, context: RequestContext): DemoPayload {
  const parsed = requestContextSchema.parse(context);
  return demoPingPayloadSchema.parse({ mode, correlationId: parsed.correlation_id, requestId: parsed.request_id });
}
