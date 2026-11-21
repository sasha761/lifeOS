import {
  completeOnboardingInputSchema, goalCommandOptionsSchema, ONBOARDING_CATALOG_VERSION, onboardingAnswersSchema, onboardingStateSchema,
  saveOnboardingDraftInputSchema, timeZoneSchema,
} from "@lifeos/contracts";
import type {
  CheckinRhythm, CompleteOnboardingInput, DomainKey, Goal, GoalCommandOptions, OnboardingAnswers, OnboardingCompleted, OnboardingState,
  OnboardingStatus,
} from "@lifeos/contracts";
import type { Actor } from "./actor.ts";
import { ConflictError, InvalidInputError, NotFoundError } from "./errors.ts";
import { goalAuditSnapshot } from "./events.ts";
import type { ActivityEventWriter } from "./events.ts";
import type { GoalsRepository } from "./goals.ts";
import { buildOnboardingGoals } from "./onboarding-catalog.ts";
import { requireFound, requireOwned } from "./ownership.ts";

/** Stored `onboarding_state` row; `answers` is untrusted JSON until it passes the draft schema of its catalog version. */
export type OnboardingStateRecord = {
  user_id: string;
  status: OnboardingStatus;
  choice: OnboardingState["choice"];
  answers: unknown;
  catalog_version: number;
  completed_at: string | null;
  updated_at: string;
};
/** Owner-scoped persistence of the wizard state; one row per person. */
export type OnboardingStateRepository = {
  find(actor: Actor): Promise<OnboardingStateRecord | null>;
  /** Replaces the draft: a new, started or dismissed setup becomes `in_progress`; a completed one stays `completed`. */
  saveDraft(actor: Actor, answers: OnboardingAnswers, catalogVersion: number): Promise<OnboardingStateRecord>;
  /** `completed` with `completed_at`; the answers stay as the draft of a later setup. */
  complete(actor: Actor, answers: OnboardingAnswers, catalogVersion: number): Promise<OnboardingStateRecord>;
};
/** The person's own profile row: «сферы в фокусе», rhythm and the confirmed zone (null keeps the stored value). */
export type OnboardingProfileRepository = {
  applyOnboarding(actor: Actor, values: { focusDomains: DomainKey[]; checkinRhythm: CheckinRhythm | null; timezone: string | null }): Promise<boolean>;
};
export type OnboardingTransaction = {
  goals: Pick<GoalsRepository, "create">;
  events: ActivityEventWriter;
  state: Pick<OnboardingStateRepository, "complete">;
  profile: OnboardingProfileRepository;
};
export type OnboardingCommand = GoalCommandOptions & { operation: "onboarding.complete"; targetId: null; input: CompleteOnboardingInput };
export type OnboardingResult = { goals: number };
export type OnboardingOutcome = { kind: "success"; result: OnboardingResult } | { kind: "conflict" };
/**
 * One transaction per completion: owner/key lock, receipts of all goal commands (one key namespace), a per-owner lock,
 * the goals with their audit, the profile, the state and a receipt that replays the same count for the same key.
 */
export type OnboardingUnitOfWork = {
  state: Pick<OnboardingStateRepository, "find" | "saveDraft">;
  run(actor: Actor, command: OnboardingCommand, operation: (transaction: OnboardingTransaction) => Promise<OnboardingResult>): Promise<OnboardingOutcome>;
};
export type OnboardingService = {
  get(actor: Actor): Promise<OnboardingState>;
  saveDraft(actor: Actor, input: unknown): Promise<OnboardingState>;
  /** `completeOnboarding(actor, answers, selected)` of LFS-219; `options` is the transport context. */
  complete(actor: Actor, input: unknown, options: unknown): Promise<OnboardingCompleted>;
};

const NOT_STARTED: OnboardingState = Object.freeze({
  status: "not_started", choice: null, catalog_version: ONBOARDING_CATALOG_VERSION, answers: null, completed_at: null, updated_at: null,
});

function commandOptions(input: unknown): GoalCommandOptions {
  const parsed = goalCommandOptionsSchema.safeParse(input);
  if (!parsed.success) throw new InvalidInputError();
  return parsed.data;
}
function toState(actor: Actor, record: OnboardingStateRecord | null): OnboardingState {
  if (record === null) return NOT_STARTED;
  requireOwned(actor, { userId: record.user_id });
  // A draft of another catalog version (or one the current schema no longer reads) is not offered: the wizard starts anew.
  const answers = record.catalog_version === ONBOARDING_CATALOG_VERSION ? onboardingAnswersSchema.safeParse(record.answers) : null;
  return onboardingStateSchema.parse({
    status: record.status, choice: record.choice, catalog_version: ONBOARDING_CATALOG_VERSION,
    answers: answers?.success ? answers.data : null, completed_at: record.completed_at, updated_at: record.updated_at,
  });
}
function owned(actor: Actor, goal: Goal | null): Goal {
  const row = requireFound(goal);
  requireOwned(actor, { userId: row.user_id });
  return row;
}

/**
 * Onboarding wizard (LFS-219, ADR-012). Drafts are stored as they are; goals are created only by `complete`, from the
 * answers rebuilt on the server, with the same repository and audit as a manual goal (`origin = onboarding`, source of
 * the transport). No measurement is created: what the person already has becomes the baseline.
 */
export function createOnboardingService(unit: OnboardingUnitOfWork): OnboardingService {
  return {
    async get(actor) {
      return toState(actor, await unit.state.find(actor));
    },
    async saveDraft(actor, input) {
      const parsed = saveOnboardingDraftInputSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError();
      return toState(actor, await unit.state.saveDraft(actor, parsed.data.answers, ONBOARDING_CATALOG_VERSION));
    },
    async complete(actor, input, options) {
      const parsed = completeOnboardingInputSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError();
      const context = commandOptions(options);
      const { answers, selected } = parsed.data;
      let timezone: string | null = null;
      if (answers.timezone !== null) {
        const zone = timeZoneSchema.safeParse(answers.timezone);
        if (!zone.success) throw new InvalidInputError("timezone");
        timezone = zone.data;
      }
      const proposals = buildOnboardingGoals(answers);
      // The client checks every goal on its step; the server checks again and names the first goal that does not pass.
      for (const key of selected) {
        if (!proposals.find((proposal) => proposal.key === key)?.input) throw new InvalidInputError(key);
      }
      const chosen = proposals.filter((proposal) => selected.includes(proposal.key));
      // Kept as the draft of a later setup (from Settings, LFS-220): the answers, from the first step, without the
      // one-off goals added on the summary.
      const stored: OnboardingAnswers = { ...answers, step: "domains", extra: [], unchecked: [] };
      const command: OnboardingCommand = { ...context, operation: "onboarding.complete", targetId: null, input: parsed.data };
      const outcome = await unit.run(actor, command, async ({ goals, events, state, profile }) => {
        for (const proposal of chosen) {
          const goal = owned(actor, await goals.create(actor, proposal.input!, { origin: "onboarding" }));
          if (goal.origin !== "onboarding") throw new Error("Onboarding goal without its origin.");
          await events.append({ goal_id: goal.id, domain_key: goal.domain_key, target_type: "goal", target_id: goal.id, schema_version: 1,
            event_type: "goal.created", payload: { before: null, after: goalAuditSnapshot(goal) } });
        }
        if (!await profile.applyOnboarding(actor, { focusDomains: answers.domains, checkinRhythm: answers.rhythm, timezone })) throw new NotFoundError();
        toState(actor, await state.complete(actor, stored, ONBOARDING_CATALOG_VERSION));
        return { goals: chosen.length };
      });
      if (outcome.kind === "conflict") throw new ConflictError();
      if (outcome.kind !== "success") throw new Error("Invalid onboarding outcome.");
      return { catalog_version: ONBOARDING_CATALOG_VERSION, created_goals: outcome.result.goals };
    },
  };
}
