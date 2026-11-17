/**
 * Closed-registration policy for the personal pilot (LFS-201).
 *
 * Only new accounts are gated; existing users sign in regardless of the list.
 * Matching ignores surrounding whitespace and letter case. The allowlist limits
 * who can create an account during the pilot; it is not an authorization model.
 */
export type SignupPolicy = {
  readonly isAllowed: (email: string) => boolean;
  /** Number of distinct normalized addresses; 0 means registration is closed. */
  readonly size: number;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createSignupPolicy(allowedEmails: readonly string[]): SignupPolicy {
  const allowed = new Set(allowedEmails.map(normalizeEmail).filter((email) => email.length > 0));
  return {
    isAllowed: (email) => {
      const candidate = normalizeEmail(email);
      return candidate.length > 0 && allowed.has(candidate);
    },
    size: allowed.size,
  };
}
