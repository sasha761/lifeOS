import { z } from "zod";

/** Stable LifeOS sphere identifiers. UI, domain rules and future API input share this list. */
export const DOMAIN_KEYS = Object.freeze([
  "languages", "finance", "work", "projects", "skills", "health",
] as const);

// Deliberately exact: no trimming, case conversion or arbitrary seventh key.
export const domainKeySchema = z.enum(DOMAIN_KEYS);
export type DomainKey = z.infer<typeof domainKeySchema>;
