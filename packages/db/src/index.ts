export { createDatabase } from "./client.ts";
export type { DatabaseClient, DatabaseOptions, LifeosDatabase, LifeosTransaction } from "./client.ts";
export { DatabaseConfigurationError, parseDatabaseUrl, readTestDatabaseUrl, databaseErrorMessage } from "./configuration.ts";
export { ownedBy } from "./ownership.ts";
export { createUserPreferencesRepository } from "./repositories/user-preferences.ts";
export { createGoalsRepository } from "./repositories/goals.ts";
export { createActivityEventsRepository } from "./repositories/activity-events.ts";
export { createGoalsUnitOfWork } from "./goals-unit-of-work.ts";
export { createActivityEventWriter } from "./activity-event-writer.ts";
export { createGoalMeasurementsRepository } from "./repositories/goal-measurements.ts";
export { createGoalMeasurementsUnitOfWork } from "./goal-measurements-unit-of-work.ts";
export * as schema from "./schema/index.ts";
// Migrations are a separate entry point (@lifeos/db/migrations): runtime consumers such as the
// Next.js bundle must not pull in the migrator or the SQL folder.
export { createGoalsReadRepository } from "./repositories/goals-reader.ts";
export { createDashboardReadRepository } from "./repositories/dashboard-reader.ts";
