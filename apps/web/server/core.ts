import "server-only";
import { readWebEnv } from "@lifeos/config/env";
import { createUserPreferencesRepository, createGoalsUnitOfWork, createGoalMeasurementsUnitOfWork, createGoalsReadRepository, createDashboardReadRepository } from "@lifeos/db";
import { createUserPreferencesService, createGoalsService, createGoalMeasurementsService, createGoalsReader, createDashboardReader } from "@lifeos/domain";
import type { UserPreferencesService, GoalsService, GoalMeasurementsService, GoalsReader, DashboardReader } from "@lifeos/domain";
import { getDatabase } from "./db.ts";

// Composition of core domain services (lazy: never during `next build`). Cached per module, not on
// globalThis: RSC pages and Route Handlers are separate bundle layers with their own copies of
// @lifeos/domain, and a service shared between them would throw errors of the other layer's classes.
// Only the connection pool is process-wide (server/db.ts).
let userPreferences: UserPreferencesService | undefined;
let goals: GoalsService | undefined;
let measurements: GoalMeasurementsService | undefined;
let goalsReader: GoalsReader | undefined;
let dashboardReader: DashboardReader | undefined;

export function getUserPreferencesService(): UserPreferencesService {
  userPreferences ??= createUserPreferencesService(
    createUserPreferencesRepository(getDatabase(readWebEnv(process.env).DATABASE_URL).db),
  );
  return userPreferences;
}

export function getGoalsService(): GoalsService {
  goals ??= createGoalsService(createGoalsUnitOfWork(getDatabase(readWebEnv(process.env).DATABASE_URL).db));
  return goals;
}
export function getGoalMeasurementsService(): GoalMeasurementsService {
  measurements ??= createGoalMeasurementsService(createGoalMeasurementsUnitOfWork(getDatabase(readWebEnv(process.env).DATABASE_URL).db));
  return measurements;
}
export function getGoalsReader(): GoalsReader {
  goalsReader ??= createGoalsReader(createGoalsReadRepository(getDatabase(readWebEnv(process.env).DATABASE_URL).db));
  return goalsReader;
}
export function getDashboardReader(): DashboardReader {
  dashboardReader ??= createDashboardReader(createDashboardReadRepository(getDatabase(readWebEnv(process.env).DATABASE_URL).db));
  return dashboardReader;
}
