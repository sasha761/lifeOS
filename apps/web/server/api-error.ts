import { ERROR_MESSAGES } from "@lifeos/contracts";
import type { ApiErrorBody, ErrorCode } from "@lifeos/contracts";
import { isDomainError } from "@lifeos/domain";

const statusCodes = {
  VALIDATION_ERROR: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  RATE_LIMITED: 429, CONFLICT: 409, INTERNAL_ERROR: 500, AI_UNAVAILABLE: 503, BUDGET_EXCEEDED: 429,
} as const satisfies Record<ErrorCode, number>;

export class ApiError extends Error {
  constructor(readonly code: ErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "ApiError";
  }
}

function errorCode(error: unknown): ErrorCode {
  if (error instanceof ApiError) return error.code;
  // Expected domain rule violations (NOT_FOUND for missing or foreign resources, VALIDATION_ERROR, …).
  // Not `instanceof`: a service may come from another Next.js bundle layer with its own module copy.
  if (isDomainError(error)) return error.code;
  return "INTERNAL_ERROR";
}

export function mapApiError(error: unknown): { status: number; error: ApiErrorBody } {
  const code = errorCode(error);
  // The public message is always the fixed one for the code, never the thrown error's text.
  return { status: statusCodes[code], error: { code, message: ERROR_MESSAGES[code] } };
}
