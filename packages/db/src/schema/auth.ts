import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Better Auth 1.7.18 core schema for email/password (LFS-201).
// Mirrors the official Drizzle generator for provider "pg": text ids, snake_case columns,
// cascade foreign keys and `<model>_<field>_idx` indexes. Table/column names and types are
// owned by Better Auth; extra user fields are added by separate migrations (LFS-202).
// Timestamps are written by Better Auth as UTC; reset-token identifiers are stored hashed
// (verification.storeIdentifier = "hashed"), passwords only as scrypt hashes in account.password.
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  // LFS-202 preferences (0002_user_preferences). Not Better Auth fields: it never writes them, so
  // inserts take these defaults (= DEFAULT_USER_PREFERENCES in @lifeos/domain) and only the domain
  // preferences service changes them, with IANA/BCP 47 validation. The CHECKs are a coarse backstop.
  timezone: text("timezone").default("UTC").notNull(),
  locale: text("locale").default("ru").notNull(),
}, (table) => [
  check("user_timezone_length_check", sql`char_length(${table.timezone}) BETWEEN 1 AND 64`),
  check("user_locale_length_check", sql`char_length(${table.locale}) BETWEEN 2 AND 35`),
]);

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date()).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
}, (table) => [index("session_userId_idx").on(table.userId)]);

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date()).notNull(),
}, (table) => [index("account_userId_idx").on(table.userId)]);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);
