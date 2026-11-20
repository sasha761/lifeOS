import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { check as pgCheck, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { ONBOARDING_START_CHOICES, ONBOARDING_STATUSES } from "@lifeos/contracts";
import { user } from "./auth.ts";

// DDL cannot contain bind parameters. Only trusted registry constants are interpolated here.
const check = (name: string, expression: SQL) => pgCheck(name, expression.inlineParams());
const choices = (values: readonly string[]) => sql.join(values.map((value) => sql`${value}`), sql`, `);

/**
 * Onboarding wizard state, one row per person (LFS-219, ADR-012). No row means `not_started`. `dismissed` and `choice`
 * exist from the start so that the first-visit popup (LFS-220) needs no migration. `answers` is the draft as the person
 * left it, validated by the draft schema of `catalog_version` on every read; it holds no goal, measurement or identity.
 */
export const onboardingState = pgTable("onboarding_state", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  status: text("status", { enum: ONBOARDING_STATUSES }).default("not_started").notNull(),
  choice: text("choice", { enum: ONBOARDING_START_CHOICES }),
  answers: jsonb("answers"),
  catalogVersion: integer("catalog_version").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true, precision: 3 }),
  updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
}, (table) => [
  check("onboarding_state_status_check", sql`${table.status} IN (${choices(ONBOARDING_STATUSES)})`),
  check("onboarding_state_choice_check", sql`${table.choice} IS NULL OR ${table.choice} IN (${choices(ONBOARDING_START_CHOICES)})`),
  // A bounded JSON object; its structure is the contract's job, the size and type are the database's backstop.
  check("onboarding_state_answers_check", sql`${table.answers} IS NULL OR (jsonb_typeof(${table.answers}) = 'object' AND pg_column_size(${table.answers}) <= 65536)`),
  check("onboarding_state_version_check", sql`${table.catalogVersion} >= 1`),
  check("onboarding_state_completed_check", sql`${table.status} <> 'completed' OR ${table.completedAt} IS NOT NULL`),
  check("onboarding_state_time_check", sql`isfinite(${table.updatedAt}) AND (${table.completedAt} IS NULL OR isfinite(${table.completedAt}))`),
]);

/**
 * Retry proof of «Создать N целей» (LFS-219), in the same owner/key namespace as the other goal commands. Like
 * starter_pack_receipts it has no goal FK and holds only a count, never titles or values.
 */
export const onboardingReceipts = pgTable("onboarding_receipts", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  goals: integer("goals").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ name: "onboarding_receipts_pk", columns: [table.userId, table.idempotencyKey] }),
  check("onboarding_receipts_key_check", sql`char_length(${table.idempotencyKey}) BETWEEN 1 AND 128 AND ${table.idempotencyKey} !~ '[^A-Za-z0-9._:-]'`),
  check("onboarding_receipts_hash_check", sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
  check("onboarding_receipts_goals_check", sql`${table.goals} >= 1`),
  check("onboarding_receipts_time_check", sql`isfinite(${table.createdAt})`),
]);
