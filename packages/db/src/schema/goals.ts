import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { check as pgCheck, index, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import {
  DOMAIN_KEYS, GOAL_DECIMAL_INTEGER_DIGITS, GOAL_DECIMAL_SCALE, GOAL_DESCRIPTION_MAX_LENGTH,
  GOAL_DIRECTIONS, GOAL_STATUSES, GOAL_TITLE_MAX_LENGTH, GOAL_UNIT_LABEL_MAX_LENGTH, GOAL_UNITS,
} from "@lifeos/contracts";
import { user } from "./auth.ts";

const choices = (values: readonly string[]) => sql.join(values.map((value) => sql`${value}`), sql`, `);
// DDL cannot contain bind parameters. Only trusted registry constants are interpolated here.
const check = (name: string, expression: SQL) => pgCheck(name, expression.inlineParams());

export const goals = pgTable("goals", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  domainKey: text("domain_key", { enum: DOMAIN_KEYS }).notNull(),
  title: text("title").notNull(),
  description: text("description"),
  unit: text("unit", { enum: GOAL_UNITS }).notNull(),
  unitLabel: text("unit_label"),
  // Unconstrained numeric + CHECK rejects excess fractional precision instead of rounding on assignment.
  // Drizzle/pg retain strings: never use numeric mode:number or Number() for amounts.
  baseline: numeric("baseline").notNull(),
  target: numeric("target").notNull(),
  direction: text("direction", { enum: GOAL_DIRECTIONS }).notNull(),
  calculationMode: text("calculation_mode", { enum: ["manual", "computed"] }).default("manual").notNull(),
  metricKey: text("metric_key"),
  status: text("status", { enum: GOAL_STATUSES }).default("active").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true, precision: 3 }),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
}, (table) => [
  unique("goals_owner_domain_id_unique").on(table.userId, table.domainKey, table.id),
  unique("goals_owner_id_unit_unique").on(table.userId, table.id, table.unit),
  check("goals_domain_key_check", sql`${table.domainKey} IN (${choices(DOMAIN_KEYS)})`),
  check("goals_title_check", sql`char_length(${table.title}) BETWEEN 1 AND ${GOAL_TITLE_MAX_LENGTH} AND btrim(${table.title}) <> ''`),
  check("goals_description_check", sql`${table.description} IS NULL OR (char_length(${table.description}) BETWEEN 1 AND ${GOAL_DESCRIPTION_MAX_LENGTH} AND btrim(${table.description}) <> '')`),
  check("goals_unit_check", sql`${table.unit} IN (${choices(GOAL_UNITS)})`),
  check("goals_unit_label_check", sql`CASE WHEN ${table.unit} = 'custom' THEN ${table.unitLabel} IS NOT NULL AND char_length(${table.unitLabel}) BETWEEN 1 AND ${GOAL_UNIT_LABEL_MAX_LENGTH} AND btrim(${table.unitLabel}) <> '' ELSE ${table.unitLabel} IS NULL END`),
  check("goals_values_check", sql`${table.baseline} >= 0 AND ${table.target} >= 0 AND ${table.baseline} < power(10::numeric, ${GOAL_DECIMAL_INTEGER_DIGITS}) AND ${table.target} < power(10::numeric, ${GOAL_DECIMAL_INTEGER_DIGITS}) AND ${table.baseline} = trunc(${table.baseline}, ${GOAL_DECIMAL_SCALE}) AND ${table.target} = trunc(${table.target}, ${GOAL_DECIMAL_SCALE})`),
  check("goals_unit_values_check", sql`CASE ${table.unit} WHEN 'NOK' THEN ${table.baseline} = trunc(${table.baseline}, 2) AND ${table.target} = trunc(${table.target}, 2) WHEN 'count' THEN ${table.baseline} = trunc(${table.baseline}) AND ${table.target} = trunc(${table.target}) WHEN 'percent' THEN ${table.baseline} <= 100 AND ${table.target} <= 100 ELSE true END`),
  check("goals_direction_check", sql`(${table.direction} = 'increase' AND ${table.target} > ${table.baseline}) OR (${table.direction} = 'decrease' AND ${table.target} < ${table.baseline})`),
  check("goals_manual_check", sql`${table.calculationMode} = 'manual' AND ${table.metricKey} IS NULL`),
  check("goals_status_check", sql`${table.status} IN (${choices(GOAL_STATUSES)})`),
  check("goals_due_at_check", sql`${table.dueAt} IS NULL OR (isfinite(${table.dueAt}) AND EXTRACT(YEAR FROM ${table.dueAt} AT TIME ZONE 'UTC') BETWEEN 1 AND 9999)`),
  check("goals_timestamps_check", sql`isfinite(${table.createdAt}) AND isfinite(${table.updatedAt}) AND EXTRACT(YEAR FROM ${table.createdAt} AT TIME ZONE 'UTC') BETWEEN 1 AND 9999 AND EXTRACT(YEAR FROM ${table.updatedAt} AT TIME ZONE 'UTC') BETWEEN 1 AND 9999`),
  index("goals_user_domain_status_idx").on(table.userId, table.domainKey, table.status),
  index("goals_user_status_due_idx").on(table.userId, table.status, table.dueAt, table.id),
]);
