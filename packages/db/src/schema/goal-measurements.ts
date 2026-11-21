import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { check as pgCheck, foreignKey, index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import {
  GOAL_DECIMAL_INTEGER_DIGITS, GOAL_DECIMAL_SCALE, GOAL_MEASUREMENT_SOURCES, GOAL_UNITS, MEASUREMENT_FUTURE_TOLERANCE_MS, MEASUREMENT_NOTE_MAX_LENGTH,
} from "@lifeos/contracts";
import { goals } from "./goals.ts";
const check = (name: string, expression: SQL) => pgCheck(name, expression.inlineParams());
const choices = (values: readonly string[]) => sql.join(values.map((value) => sql`${value}`), sql`, `);

export const goalMeasurements = pgTable("goal_measurements", {
  id: uuid("id").defaultRandom().primaryKey(),
  goalId: uuid("goal_id").notNull(),
  userId: text("user_id").notNull(),
  // Parent unit is copied by the server and protected by the compound FK.
  unit: text("unit", { enum: GOAL_UNITS }).notNull(),
  value: numeric("value").notNull(),
  measuredAt: timestamp("measured_at", { withTimezone: true, precision: 3 }).notNull(),
  // `example` only from the example the person chose to load (LFS-218); the public API creates `manual` only.
  source: text("source", { enum: GOAL_MEASUREMENT_SOURCES }).default("manual").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).default(sql`clock_timestamp()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).default(sql`clock_timestamp()`).notNull(),
}, (table) => [
  foreignKey({ name: "goal_measurements_owned_unit_fk", columns: [table.userId, table.goalId, table.unit], foreignColumns: [goals.userId, goals.id, goals.unit] }).onDelete("cascade"),
  check("goal_measurements_value_check", sql`${table.value} >= 0 AND ${table.value} < power(10::numeric, ${GOAL_DECIMAL_INTEGER_DIGITS}) AND ${table.value} = trunc(${table.value}, ${GOAL_DECIMAL_SCALE})`),
  check("goal_measurements_unit_value_check", sql`CASE WHEN ${table.unit} IN ('NOK', 'USD') THEN ${table.value} = trunc(${table.value},2) WHEN ${table.unit} = 'count' THEN ${table.value} = trunc(${table.value}) WHEN ${table.unit} = 'percent' THEN ${table.value} <= 100 ELSE true END`),
  check("goal_measurements_source_check", sql`${table.source} IN (${choices(GOAL_MEASUREMENT_SOURCES)})`),
  check("goal_measurements_note_check", sql`${table.note} IS NULL OR (char_length(${table.note}) BETWEEN 1 AND ${MEASUREMENT_NOTE_MAX_LENGTH} AND btrim(${table.note}) <> '')`),
  check("goal_measurements_time_check", sql`isfinite(${table.measuredAt}) AND EXTRACT(YEAR FROM ${table.measuredAt} AT TIME ZONE 'UTC') BETWEEN 1 AND 9999 AND ${table.measuredAt} <= clock_timestamp() + ${MEASUREMENT_FUTURE_TOLERANCE_MS} * interval '1 millisecond' AND isfinite(${table.createdAt}) AND isfinite(${table.updatedAt})`),
  index("goal_measurements_current_idx").on(table.userId, table.goalId, table.measuredAt, table.createdAt, table.id),
]);
