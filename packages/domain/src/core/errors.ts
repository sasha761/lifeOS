import type { ErrorCode } from "@lifeos/contracts";

/** Error codes a domain rule may raise; HTTP adapters map them to the common API envelope. */
export const DOMAIN_ERROR_CODES = ["VALIDATION_ERROR", "NOT_FOUND", "FORBIDDEN", "CONFLICT"] as const satisfies readonly ErrorCode[];
export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

// Next.js bundles server code per layer (RSC pages, Route Handlers), so one process can hold several
// copies of this module, and `instanceof` fails for an error created by another copy. A registry
// symbol marks every DomainError so adapters can recognise it from any copy (see isDomainError).
const DOMAIN_ERROR_BRAND = Symbol.for("@lifeos/domain/DomainError");
const domainErrorCodes: ReadonlySet<string> = new Set(DOMAIN_ERROR_CODES);

/** Expected rule violations. Messages are fixed and never contain input values or other users' data. */
export class DomainError extends Error {
  constructor(readonly code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    Object.defineProperty(this, DOMAIN_ERROR_BRAND, { value: true });
  }
}

/** True for a DomainError from any copy of this package; the code must also be a known domain code. */
export function isDomainError(error: unknown): error is DomainError {
  if (error instanceof DomainError) return true;
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown } & Record<symbol, unknown>;
  return candidate[DOMAIN_ERROR_BRAND] === true && typeof candidate.code === "string" && domainErrorCodes.has(candidate.code);
}

/** A missing resource and another user's resource are the same error, so existence is never revealed. */
export class NotFoundError extends DomainError {
  constructor() {
    super("NOT_FOUND", "Resource not found.");
    this.name = "NotFoundError";
  }
}

export class InvalidInputError extends DomainError {
  constructor() {
    super("VALIDATION_ERROR", "Invalid input.");
    this.name = "InvalidInputError";
  }
}

/** A valid command conflicts with the current resource state (for example an archived goal). */
export class ConflictError extends DomainError {
  constructor() {
    super("CONFLICT", "Resource conflict.");
    this.name = "ConflictError";
  }
}
