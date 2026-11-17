import { z } from "zod";
import { goalDetailsSchema, goalsPageSchema, measurementsPageSchema } from "./goals-api.ts";
import { goalMeasurementSchema, goalMeasurementDeletionSchema } from "./goal-measurements.ts";
import { dashboardSchema } from "./dashboard.ts";
export * from "./goals-api.ts";
export * from "./dashboard.ts";

export { DOMAIN_KEYS, domainKeySchema } from "./domains.ts";
export type { DomainKey } from "./domains.ts";
export {
  createGoalInputSchema, GOAL_DECIMAL_INTEGER_DIGITS, GOAL_DECIMAL_SCALE, GOAL_DESCRIPTION_MAX_LENGTH,
  GOAL_DIRECTIONS, GOAL_STATUSES, GOAL_TITLE_MAX_LENGTH, GOAL_UNIT_LABEL_MAX_LENGTH, GOAL_UNITS,
  goalCalculationModeSchema, goalDecimalSchema, goalDecimalToScaledInteger, goalDirectionSchema,
  goalIdSchema, goalInstantSchema, goalSchema, goalStatusSchema, goalUnitSchema, goalValueMatchesUnit, updateGoalInputSchema,
} from "./goals.ts";
export type { CreateGoalInput, Goal, UpdateGoalInput } from "./goals.ts";
export {
  ACTIVITY_EVENT_TYPES, ACTIVITY_SOURCES, activeActivitySourceSchema, activityEventDraftSchema,
  activityEventMetadataSchema, activitySourceSchema, GOAL_AUDIT_FIELDS, goalAuditSnapshotSchema,
  goalCommandOptionsSchema, MEASUREMENT_AUDIT_FIELDS,
} from "./activity-events.ts";
export type { ActivityEvent, ActivityEventDraft, GoalCommandOptions } from "./activity-events.ts";
export {
  createGoalMeasurementInputSchema, goalMeasurementCurrentSchema, goalMeasurementDeletionSchema, goalMeasurementSchema,
  MEASUREMENT_FUTURE_TOLERANCE_MS, MEASUREMENT_NOTE_MAX_LENGTH, updateGoalMeasurementInputSchema,
} from "./goal-measurements.ts";
export type { CreateGoalMeasurementInput, GoalMeasurement, GoalMeasurementCurrent, GoalMeasurementDeletion, UpdateGoalMeasurementInput } from "./goal-measurements.ts";

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
export { idempotencyKeySchema } from "./idempotency.ts";
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

// Auth (LFS-201). Better Auth serves /api/auth/*; these DTOs validate form input before it is sent
// and describe the session-protected identity. The server (Better Auth config) enforces the same limits.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const USER_NAME_MAX_LENGTH = 100;
/** Rejection code returned by sign-up for an email outside the server-side allowlist. */
export const SIGNUP_NOT_ALLOWED = "SIGNUP_NOT_ALLOWED";
/** Password reset request whose email could not be delivered (HTTP 503); never reported as sent. */
export const EMAIL_DELIVERY_FAILED = "EMAIL_DELIVERY_FAILED";
export const emailAddressSchema = z.string().trim().max(254).pipe(z.email());
export const newPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
export const signUpInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(USER_NAME_MAX_LENGTH),
  email: emailAddressSchema,
  password: newPasswordSchema,
});
export type SignUpInput = z.infer<typeof signUpInputSchema>;
// Sign-in does not apply the new-password policy: existing credentials are verified only by the server.
export const signInInputSchema = z.strictObject({
  email: emailAddressSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type SignInInput = z.infer<typeof signInInputSchema>;
export const passwordResetRequestSchema = z.strictObject({ email: emailAddressSchema });
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;
export const passwordResetInputSchema = z.strictObject({
  token: z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/),
  password: newPasswordSchema,
});
export type PasswordResetInput = z.infer<typeof passwordResetInputSchema>;
/** Minimal identity returned by GET /api/v1/me; never includes session tokens or credentials. */
export const currentUserSchema = z.strictObject({
  id: z.string().min(1).max(128),
  email: z.email(),
  name: z.string().max(USER_NAME_MAX_LENGTH),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;
export const currentUserResponseSchema = apiResponseSchema(currentUserSchema);
export type CurrentUserResponse = z.infer<typeof currentUserResponseSchema>;

// User preferences (LFS-202). The same normalizers back the API, the domain service and the form;
// the server is authoritative because browsers may ship a different ICU time zone/locale set.
export const TIME_ZONE_MAX_LENGTH = 64;
export const LOCALE_MAX_LENGTH = 35;
// IANA names such as "Europe/Oslo", "UTC" or "Etc/GMT+5". Intl also accepts UTC offsets ("+01:00"),
// but those are not IANA zones and ignore daylight saving, so the syntax check rejects them.
const IANA_TIME_ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;
let timeZoneSpellings: Map<string, string> | undefined;

/** IANA zones known to this runtime, with "UTC" first (Intl.supportedValuesOf omits it). */
export function supportedTimeZones(): string[] {
  return ["UTC", ...Intl.supportedValuesOf("timeZone").filter((zone) => zone !== "UTC")];
}

/** A valid IANA time zone in its canonical spelling when the runtime lists it, otherwise null. */
export function normalizeTimeZone(value: string): string | null {
  const candidate = value.trim();
  if (candidate.length === 0 || candidate.length > TIME_ZONE_MAX_LENGTH || !IANA_TIME_ZONE_PATTERN.test(candidate)) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).resolvedOptions();
  } catch {
    return null;
  }
  // Lookups are case-insensitive; keep the runtime's spelling ("europe/oslo" → "Europe/Oslo") and
  // valid names it does not list as-is (e.g. "Europe/Kyiv"), instead of ICU's legacy aliases.
  timeZoneSpellings ??= new Map(supportedTimeZones().map((zone) => [zone.toLowerCase(), zone]));
  return timeZoneSpellings.get(candidate.toLowerCase()) ?? candidate;
}

/** A well-formed BCP 47 tag in canonical form ("en-us" → "en-US") that can format dates, otherwise null. */
export function normalizeLocale(value: string): string | null {
  const candidate = value.trim();
  if (candidate.length === 0 || candidate.length > LOCALE_MAX_LENGTH) return null;
  let canonical: string | undefined;
  try {
    [canonical] = Intl.getCanonicalLocales(candidate);
  } catch {
    return null;
  }
  // Well-formed but unusable tags ("und", unknown languages) would silently fall back to another locale.
  if (!canonical || canonical.length > LOCALE_MAX_LENGTH || Intl.DateTimeFormat.supportedLocalesOf([canonical]).length === 0) return null;
  return canonical;
}

function normalizedInput(normalize: (value: string) => string | null, maxLength: number) {
  return z.string().trim().min(1).max(maxLength).transform((value, context) => {
    const normalized = normalize(value);
    if (normalized !== null) return normalized;
    context.addIssue({ code: "custom", message: "Unsupported value." });
    return z.NEVER;
  });
}
export const timeZoneSchema = normalizedInput(normalizeTimeZone, TIME_ZONE_MAX_LENGTH);
export const localeSchema = normalizedInput(normalizeLocale, LOCALE_MAX_LENGTH);
/** Stored preferences as returned by the API. Not re-validated on output, so an ICU update cannot lock a user out. */
export const userPreferencesSchema = z.strictObject({
  timezone: z.string().min(1).max(TIME_ZONE_MAX_LENGTH),
  locale: z.string().min(2).max(LOCALE_MAX_LENGTH),
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;
/** PATCH /api/v1/me/preferences body. Strict: owner identifiers such as `userId` are rejected, never read. */
export const updateUserPreferencesInputSchema = z.strictObject({
  timezone: timeZoneSchema.optional(),
  locale: localeSchema.optional(),
}).refine((input) => input.timezone !== undefined || input.locale !== undefined, { message: "Nothing to update." });
export type UpdateUserPreferencesInput = z.infer<typeof updateUserPreferencesInputSchema>;
export const userPreferencesResponseSchema = apiResponseSchema(userPreferencesSchema);
export type UserPreferencesResponse = z.infer<typeof userPreferencesResponseSchema>;

export const goalDetailsResponseSchema = apiResponseSchema(goalDetailsSchema);
export const goalsPageResponseSchema = apiResponseSchema(goalsPageSchema);
export const measurementsPageResponseSchema = apiResponseSchema(measurementsPageSchema);
export const goalMeasurementResponseSchema = apiResponseSchema(goalMeasurementSchema);
export const goalMeasurementDeletionResponseSchema = apiResponseSchema(goalMeasurementDeletionSchema);
export const dashboardResponseSchema = apiResponseSchema(dashboardSchema);
