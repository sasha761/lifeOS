import "server-only";
import { readWebEnv } from "@lifeos/config/env";
import { createUserPreferencesRepository, createGoalsUnitOfWork, createGoalMeasurementsUnitOfWork, createGoalsReadRepository } from "@lifeos/db";
import { createUserPreferencesService, createGoalsService, createGoalMeasurementsService, createGoalsReader } from "@lifeos/domain";
import type { UserPreferencesService, GoalsService, GoalMeasurementsService, GoalsReader } from "@lifeos/domain";
import { getDatabase } from "./db.ts";

// Composition of core domain services (lazy: never during `next build`). Cached per module, not on
// globalThis: RSC pages and Route Handlers are separate bundle layers with their own copies of
// @lifeos/domain, and a service shared between them would throw errors of the other layer's classes.
// Only the connection pool is process-wide (server/db.ts).
let userPreferences: UserPreferencesService | undefined;
let goals: GoalsService | undefined;
let measurements: GoalMeasurementsService | undefined;
let goalsReader: GoalsReader | undefined;

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
