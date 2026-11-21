import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

/**
 * Retry proof of the example commands (LFS-218): loading it and «Удалить все примеры». Like goal_deletion_receipts it
 * has no goal FK, so the proof survives the deletion of the goals; it holds only counts, never titles or values.
 */
export const starterPackReceipts = pgTable("starter_pack_receipts", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  operation: text("operation", { enum: ["starter_pack.apply", "starter_pack.remove"] }).notNull(),
  goals: integer("goals").notNull(),
  measurements: integer("measurements").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ name: "starter_pack_receipts_pk", columns: [table.userId, table.idempotencyKey] }),
  check("starter_pack_receipts_key_check", sql`char_length(${table.idempotencyKey}) BETWEEN 1 AND 128 AND ${table.idempotencyKey} !~ '[^A-Za-z0-9._:-]'`),
  check("starter_pack_receipts_hash_check", sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
  check("starter_pack_receipts_operation_check", sql`${table.operation} IN ('starter_pack.apply', 'starter_pack.remove')`),
  check("starter_pack_receipts_counts_check", sql`${table.goals} >= 0 AND ${table.measurements} >= 0`),
  check("starter_pack_receipts_time_check", sql`isfinite(${table.createdAt})`),
]);
