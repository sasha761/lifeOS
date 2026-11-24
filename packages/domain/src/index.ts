// Framework-independent domain rules and interfaces. No Next.js, React, apps/* or direct SQL here.
export { createOpenSignupPolicy, createSignupPolicy, normalizeEmail } from "./auth/signup-policy.ts";
export type { SignupMode, SignupPolicy } from "./auth/signup-policy.ts";
export { ACTOR_USER_ID_MAX_LENGTH, actorFromVerifiedSession } from "./core/actor.ts";
export type { Actor } from "./core/actor.ts";
export { ConflictError, DOMAIN_ERROR_CODES, DomainError, InvalidInputError, isDomainError, NotFoundError } from "./core/errors.ts";
export type { DomainErrorCode } from "./core/errors.ts";
export { requireFound, requireOwned } from "./core/ownership.ts";
export type { Owned } from "./core/ownership.ts";
export { createUserPreferencesService, DEFAULT_USER_PREFERENCES } from "./core/user-preferences.ts";
export type { UserPreferencesRepository, UserPreferencesService } from "./core/user-preferences.ts";
export { findLifeDomain, LIFE_DOMAINS } from "./core/domains.ts";
export type { DomainLocale, LifeDomain, LocalizedDomainText } from "./core/domains.ts";
export { createGoalsService } from "./core/goals.ts";
export type { GoalCommand, GoalCommandOutcome, GoalDeletionCommand, GoalDeletionOutcome, GoalTransaction, GoalsRepository, GoalsService, GoalsUnitOfWork } from "./core/goals.ts";
export { goalAuditSnapshot, measurementDeletedEvent, measurementSnapshot } from "./core/events.ts";
export type { ActivityEventsRepository, ActivityEventWriter } from "./core/events.ts";
export { createGoalMeasurementsService } from "./core/goal-measurements.ts";
export type {
  GoalMeasurementsRepository, GoalMeasurementsService, GoalMeasurementsUnitOfWork, MeasurementCommand,
  MeasurementCommandOutcome, MeasurementDraft, MeasurementMutationResult, MeasurementTransaction,
} from "./core/goal-measurements.ts";
export { createStarterPackService, STARTER_PACK, STARTER_PACK_NOTE } from "./core/starter-pack.ts";
export type {
  StarterPackCommand, StarterPackOutcome, StarterPackRepository, StarterPackResult, StarterPackService, StarterPackTransaction,
  StarterPackUnitOfWork,
} from "./core/starter-pack.ts";
export { createOnboardingService, readStoredOnboardingAnswers, showsStartDialog } from "./core/onboarding.ts";
export type {
  OnboardingCommand, OnboardingOutcome, OnboardingOverviewRecord, OnboardingOverviewRepository, OnboardingProfileRepository, OnboardingResult,
  OnboardingService, OnboardingStateRecord, OnboardingStateRepository, OnboardingTransaction, OnboardingUnitOfWork,
} from "./core/onboarding.ts";
// The catalog and the goal builder are also the separate browser-safe entry point `@lifeos/domain/onboarding`.
export * from "./core/onboarding-catalog.ts";
export { calculateContributionCurrent, calculateGoalProgress, contributionKind } from "./core/goal-progress.ts";
export { createGoalsReader, goalDetailsFromRecord } from "./core/goals-reader.ts";
export type { GoalReadRecord, GoalsReadQuery, MeasurementsReadQuery, GoalsReadRepository, GoalsReader } from "./core/goals-reader.ts";
export { createActivityReader, isVisibleActivity, toActivityEntry } from "./core/activity.ts";
export type { ActivityFilter, ActivityReadRepository, ActivityReader, ActivityRecord } from "./core/activity.ts";
export { createDashboardReader, DASHBOARD_LIMITS } from "./core/dashboard.ts";
export type {
  DashboardActivityRecord, DashboardCountRecord, DashboardLimits, DashboardReader, DashboardReadRecord, DashboardReadRepository,
} from "./core/dashboard.ts";
