import { z } from "zod";

/** Version of the example set (LFS-218); a changed set is a new version, never a rewrite of loaded examples. */
export const STARTER_PACK_VERSION = 1;
const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/**
 * POST /api/v1/starter-pack: the example the person chose to load — goals with `origin = starter` and their example
 * measurements, created in one transaction. A retry with the same Idempotency-Key returns the same counts.
 */
export const starterPackAppliedSchema = z.strictObject({
  version: z.literal(STARTER_PACK_VERSION),
  created_goals: countSchema,
  created_measurements: countSchema,
});
export type StarterPackApplied = z.infer<typeof starterPackAppliedSchema>;

/**
 * DELETE /api/v1/starter-pack («Удалить все примеры»): goals still labelled «Пример» are hard deleted with their
 * measurements, history and receipts; goals the person made their own stay. A retry returns the same count.
 */
export const starterPackRemovedSchema = z.strictObject({ deleted_goals: countSchema });
export type StarterPackRemoved = z.infer<typeof starterPackRemovedSchema>;
