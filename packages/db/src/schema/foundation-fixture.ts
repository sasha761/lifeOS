import { pgTable, text, uuid } from "drizzle-orm/pg-core";

// Technical migration fixture only. Not a user or domain table.
export const foundationMigrationFixture = pgTable("foundation_migration_fixture", {
  id: uuid("id").defaultRandom().primaryKey(),
  label: text("label").notNull(),
});
