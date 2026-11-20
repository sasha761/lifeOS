import { sql } from "drizzle-orm";
import { check, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

/** Minimal retry proof after hard deletion; no goal FK, metadata, history or response snapshot. */
export const goalDeletionReceipts = pgTable("goal_deletion_receipts", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  targetId: uuid("target_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ name: "goal_deletion_receipts_pk", columns: [table.userId, table.idempotencyKey] }),
  check("goal_deletion_receipts_key_check", sql`char_length(${table.idempotencyKey}) BETWEEN 1 AND 128 AND ${table.idempotencyKey} !~ '[^A-Za-z0-9._:-]'`),
  check("goal_deletion_receipts_hash_check", sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
  check("goal_deletion_receipts_time_check", sql`isfinite(${table.createdAt})`),
]);
