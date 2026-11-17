import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { check as pgCheck, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { ACTIVITY_EVENT_TYPES, ACTIVITY_SOURCES, DOMAIN_KEYS, GOAL_AUDIT_FIELDS, MEASUREMENT_AUDIT_FIELDS } from "@lifeos/contracts";
import type { ActivityEventDraft } from "@lifeos/contracts";
import { user } from "./auth.ts";
import { goals } from "./goals.ts";

const check = (name: string, expression: SQL) => pgCheck(name, expression.inlineParams());
const choices = (values: readonly string[]) => sql.join(values.map((value) => sql`${value}`), sql`, `);
const validKey = (column: SQL) => sql`char_length(${column}) BETWEEN 1 AND 128 AND ${column} !~ '[^A-Za-z0-9._:-]'`;

export const activityEvents = pgTable("activity_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  domainKey: text("domain_key", { enum: DOMAIN_KEYS }).notNull(),
  goalId: uuid("goal_id").notNull(),
  eventType: text("event_type", { enum: ACTIVITY_EVENT_TYPES }).notNull(),
  source: text("source", { enum: ACTIVITY_SOURCES }).notNull(),
  targetType: text("target_type", { enum: ["goal", "goal_measurement"] }).notNull(),
  targetId: uuid("target_id").notNull(),
  idempotencyKey: text("idempotency_key"),
  schemaVersion: integer("schema_version").default(1).notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  payload: jsonb("payload").$type<ActivityEventDraft["payload"]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "activity_events_owned_goal_fk", columns: [table.userId, table.domainKey, table.goalId], foreignColumns: [goals.userId, goals.domainKey, goals.id] }).onDelete("cascade"),
  check("activity_events_type_check", sql`${table.eventType} IN (${choices(ACTIVITY_EVENT_TYPES)})`),
  check("activity_events_source_check", sql`${table.source} IN (${choices(ACTIVITY_SOURCES)})`),
  check("activity_events_target_check", sql`CASE WHEN ${table.eventType} LIKE 'goal.%' THEN ${table.targetType} = 'goal' AND ${table.targetId} = ${table.goalId} ELSE ${table.targetType} = 'goal_measurement' END`),
  check("activity_events_key_check", sql`${table.idempotencyKey} IS NULL OR (${validKey(sql`${table.idempotencyKey}`)})`),
  check("activity_events_version_check", sql`${table.schemaVersion} = 1`),
  check("activity_events_time_check", sql`isfinite(${table.occurredAt}) AND isfinite(${table.createdAt})`),
  check("activity_events_payload_check", sql`jsonb_typeof(${table.payload}) = 'object' AND pg_column_size(${table.payload}) <= 16384 AND ${table.payload} ? 'before' AND ${table.payload} ? 'after' AND ${table.payload} - ARRAY['before','after','changed_fields'] = '{}'::jsonb`),
  ...(["before", "after"] as const).map((side) => check(`activity_events_${side}_fields_check`, sql`
    CASE WHEN ${table.payload}->${side} = 'null'::jsonb THEN true
    WHEN jsonb_typeof(${table.payload}->${side}) = 'object' THEN
      (${table.payload}->${side}) - (CASE WHEN ${table.targetType} = 'goal' THEN ARRAY[${choices(GOAL_AUDIT_FIELDS)}] ELSE ARRAY[${choices(MEASUREMENT_AUDIT_FIELDS)}] END) = '{}'::jsonb
    ELSE false END`)),
  uniqueIndex("activity_events_user_key_unique").on(table.userId, table.idempotencyKey).where(sql`${table.idempotencyKey} IS NOT NULL`),
  index("activity_events_user_domain_time_idx").on(table.userId, table.domainKey, table.occurredAt, table.id),
  index("activity_events_user_goal_time_idx").on(table.userId, table.goalId, table.occurredAt, table.id),
]);

/** Commands on goals and their measurements share owner/key scope; no request/response snapshots. */
export const goalCommandReceipts = pgTable("goal_command_receipts", {
  userId: text("user_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  operation: text("operation", { enum: ["create", "update", "archive", "measurement.create", "measurement.update", "measurement.delete"] }).notNull(),
  source: text("source", { enum: ["manual", "web"] }).notNull(),
  goalId: uuid("goal_id").notNull(),
  domainKey: text("domain_key", { enum: DOMAIN_KEYS }).notNull(),
  resourceType: text("resource_type", { enum: ["goal", "measurement"] }).default("goal").notNull(),
  // Null for legacy goal receipts; measurement target deliberately survives deletion without a FK.
  targetId: uuid("target_id"),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ name: "goal_command_receipts_pk", columns: [table.userId, table.idempotencyKey] }),
  foreignKey({ name: "goal_command_receipts_owned_goal_fk", columns: [table.userId, table.domainKey, table.goalId], foreignColumns: [goals.userId, goals.domainKey, goals.id] }).onDelete("cascade"),
  check("goal_command_receipts_key_check", validKey(sql`${table.idempotencyKey}`)),
  check("goal_command_receipts_hash_check", sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
  check("goal_command_receipts_operation_check", sql`${table.operation} IN ('create','update','archive','measurement.create','measurement.update','measurement.delete')`),
  check("goal_command_receipts_resource_check", sql`(${table.resourceType} = 'goal' AND (${table.targetId} IS NULL OR ${table.targetId} = ${table.goalId}) AND ${table.operation} IN ('create','update','archive')) OR (${table.resourceType} = 'measurement' AND ${table.targetId} IS NOT NULL AND ${table.operation} IN ('measurement.create','measurement.update','measurement.delete'))`),
  check("goal_command_receipts_source_check", sql`${table.source} IN ('manual','web')`),
  check("goal_command_receipts_time_check", sql`isfinite(${table.createdAt})`),
]);
