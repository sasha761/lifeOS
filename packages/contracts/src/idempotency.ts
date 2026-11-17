import { z } from "zod";
export const idempotencyKeySchema = z.string().min(1).max(128).refine((value) => !/[^A-Za-z0-9._:-]/.test(value));
