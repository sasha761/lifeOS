import { ERROR_MESSAGES } from "@lifeos/contracts";
import type { ApiErrorBody, ErrorCode } from "@lifeos/contracts";

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

export function mapApiError(error: unknown): { status: number; error: ApiErrorBody } {
  const code = error instanceof ApiError ? error.code : "INTERNAL_ERROR";
  return { status: statusCodes[code], error: { code, message: ERROR_MESSAGES[code] } };
}
