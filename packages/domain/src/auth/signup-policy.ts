/**
 * Who may create a new account (LFS-201, open mode LFS-221).
 *
 * - `open`: anyone with a non-empty email; the default since LFS-221.
 * - `allowlist`: only listed addresses; an empty list closes registration completely.
 *
 * Only new accounts are gated; existing users sign in regardless of the mode or list. Matching ignores
 * surrounding whitespace and letter case. This limits who can register; it is not an authorization model.
 */
export type SignupMode = "open" | "allowlist";

export type SignupPolicy = {
  readonly mode: SignupMode;
  readonly isAllowed: (email: string) => boolean;
  /** Allowlist mode: number of distinct normalized addresses, 0 means registration is closed. Open mode: 0. */
  readonly size: number;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createSignupPolicy(allowedEmails: readonly string[]): SignupPolicy {
  const allowed = new Set(allowedEmails.map(normalizeEmail).filter((email) => email.length > 0));
  return {
    mode: "allowlist",
    isAllowed: (email) => {
      const candidate = normalizeEmail(email);
      return candidate.length > 0 && allowed.has(candidate);
    },
    size: allowed.size,
  };
}

/** Open registration; email format and uniqueness are still checked by the auth layer. */
export function createOpenSignupPolicy(): SignupPolicy {
  return { mode: "open", isAllowed: (email) => normalizeEmail(email).length > 0, size: 0 };
}
