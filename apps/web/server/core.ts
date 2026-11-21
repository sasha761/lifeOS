import "server-only";
import { readWebEnv } from "@lifeos/config/env";
import { createUserPreferencesRepository, createGoalsUnitOfWork, createGoalMeasurementsUnitOfWork, createGoalsReadRepository, createDashboardReadRepository, createActivityReadRepository, createStarterPackUnitOfWork } from "@lifeos/db";
import { createUserPreferencesService, createGoalsService, createGoalMeasurementsService, createGoalsReader, createDashboardReader, createActivityReader, createStarterPackService } from "@lifeos/domain";
import type { UserPreferencesService, GoalsService, GoalMeasurementsService, GoalsReader, DashboardReader, ActivityReader, StarterPackService } from "@lifeos/domain";
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
let activityReader: ActivityReader | undefined;
let starterPack: StarterPackService | undefined;

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
export function getActivityReader(): ActivityReader {
  activityReader ??= createActivityReader(createActivityReadRepository(getDatabase(readWebEnv(process.env).DATABASE_URL).db));
  return activityReader;
}
/** The example the person chooses to load (LFS-218); nothing calls it on sign-up or for other accounts. */
export function getStarterPackService(): StarterPackService {
  starterPack ??= createStarterPackService(createStarterPackUnitOfWork(getDatabase(readWebEnv(process.env).DATABASE_URL).db));
  return starterPack;
}
