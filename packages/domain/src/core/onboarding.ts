import {
  completeOnboardingInputSchema, DOMAIN_KEYS, goalCommandOptionsSchema, ONBOARDING_CATALOG_VERSION, onboardingAnswersSchema, onboardingStateSchema,
  saveOnboardingDraftInputSchema, updateOnboardingInputSchema,
} from "@lifeos/contracts";
import type {
  CompleteOnboardingInput, DomainKey, Goal, GoalCommandOptions, OnboardingAnswers, OnboardingCompleted, OnboardingStartChoice,
  OnboardingState, OnboardingStatus,
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
  /**
   * Start choice of the first-visit popup (LFS-220) in one conditional write: the state of the choice
   * (`ONBOARDING_START_TRANSITIONS`) unless the setup is completed. Null means the transition was refused; the draft stays.
   */
  choose(actor: Actor, choice: OnboardingStartChoice, catalogVersion: number): Promise<OnboardingStateRecord | null>;
  /**
   * The person loaded the example (LFS-220): a setup that is not completed becomes `completed` with `choice = example`;
   * a completed one is left as it is (null). Called inside the example transaction.
   */
  completeWithExample(actor: Actor, catalogVersion: number): Promise<OnboardingStateRecord | null>;
};
/**
 * The person's own profile row: «сферы в фокусе». The rhythm and the time zone are no longer written by the setup
 * (LFS-222): the zone is changed only in Settings.
 */
export type OnboardingProfileRepository = {
  applyOnboarding(actor: Actor, values: { focusDomains: DomainKey[] }): Promise<boolean>;
};
/**
 * What Settings and the popup show about the setup (LFS-220), read in one snapshot: the state row (null: not started),
 * the profile values the setup writes and the owner's goal counts by origin. Null when the actor has no profile row.
 */
export type OnboardingOverviewRecord = {
  state: OnboardingStateRecord | null;
  focusDomains: readonly string[] | null;
  goals: { total: number; onboarding: number; examples: number };
};
export type OnboardingOverviewRepository = { read(actor: Actor): Promise<OnboardingOverviewRecord | null> };
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
  state: Pick<OnboardingStateRepository, "saveDraft" | "choose">;
  overview: OnboardingOverviewRepository;
  run(actor: Actor, command: OnboardingCommand, operation: (transaction: OnboardingTransaction) => Promise<OnboardingResult>): Promise<OnboardingOutcome>;
};
export type OnboardingService = {
  get(actor: Actor): Promise<OnboardingState>;
  saveDraft(actor: Actor, input: unknown): Promise<OnboardingState>;
  /** PATCH of LFS-220: a start choice of the popup (409 for a completed setup). */
  update(actor: Actor, input: unknown): Promise<OnboardingState>;
  /** `completeOnboarding(actor, answers, selected)` of LFS-219; `options` is the transport context. */
  complete(actor: Actor, input: unknown, options: unknown): Promise<OnboardingCompleted>;
};

/**
 * The first-visit popup (LFS-220, owner decision 1): only an account without any goal, active or archived, whose setup is
 * not completed and not dismissed. Decided on the server; the browser keeps only «✕» for the session.
 */
export function showsStartDialog(status: OnboardingStatus, goals: number): boolean {
  return goals === 0 && (status === "not_started" || status === "in_progress");
}

function commandOptions(input: unknown): GoalCommandOptions {
  const parsed = goalCommandOptionsSchema.safeParse(input);
  if (!parsed.success) throw new InvalidInputError();
  return parsed.data;
}
/**
 * A stored draft as the current schema reads it, or null when it is not offered. A draft saved before LFS-222 also has
 * `rhythm` and `timezone`: they are dropped, and a draft left on the removed rhythm step resumes on the summary, the step
 * that followed it. Its deadlines stay the stored moments and are shown in the profile zone.
 */
export function readStoredOnboardingAnswers(stored: unknown): OnboardingAnswers | null {
  let draft = stored;
  if (typeof stored === "object" && stored !== null && !Array.isArray(stored)) {
    const fields: Record<string, unknown> = { ...stored };
    delete fields.rhythm;
    delete fields.timezone;
    if (fields.step === "rhythm") fields.step = "summary";
    draft = fields;
  }
  const parsed = onboardingAnswersSchema.safeParse(draft);
  return parsed.success ? parsed.data : null;
}

function toState(actor: Actor, overview: OnboardingOverviewRecord | null): OnboardingState {
  const { state: record, focusDomains, goals } = requireFound(overview);
  if (record !== null) requireOwned(actor, { userId: record.user_id });
  // A draft of another catalog version (or one the current schema no longer reads) is not offered: the wizard starts anew.
  const answers = record?.catalog_version === ONBOARDING_CATALOG_VERSION ? readStoredOnboardingAnswers(record.answers) : null;
  return onboardingStateSchema.parse({
    status: record?.status ?? "not_started", choice: record?.choice ?? null, catalog_version: ONBOARDING_CATALOG_VERSION,
    answers, completed_at: record?.completed_at ?? null, updated_at: record?.updated_at ?? null,
    // Registry order and registry keys only, as on the dashboard; the stored array is checked by SQL.
    focus_domains: DOMAIN_KEYS.filter((key) => focusDomains?.includes(key) ?? false), goals,
  });
}
function ownedRecord(actor: Actor, record: OnboardingStateRecord): OnboardingStateRecord {
  requireOwned(actor, { userId: record.user_id });
  return record;
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
      return toState(actor, await unit.overview.read(actor));
    },
    async saveDraft(actor, input) {
      const parsed = saveOnboardingDraftInputSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError();
      ownedRecord(actor, await unit.state.saveDraft(actor, parsed.data.answers, ONBOARDING_CATALOG_VERSION));
      return toState(actor, await unit.overview.read(actor));
    },
    async update(actor, input) {
      const parsed = updateOnboardingInputSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError();
      // A completed setup is not reopened or dismissed from the popup: the conditional write refuses it.
      const record = await unit.state.choose(actor, parsed.data.choice, ONBOARDING_CATALOG_VERSION);
      if (record === null) throw new ConflictError();
      ownedRecord(actor, record);
      return toState(actor, await unit.overview.read(actor));
    },
    async complete(actor, input, options) {
      const parsed = completeOnboardingInputSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError();
      const context = commandOptions(options);
      const { answers, selected } = parsed.data;
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
        if (!await profile.applyOnboarding(actor, { focusDomains: answers.domains })) throw new NotFoundError();
        ownedRecord(actor, await state.complete(actor, stored, ONBOARDING_CATALOG_VERSION));
        return { goals: chosen.length };
      });
      if (outcome.kind === "conflict") throw new ConflictError();
      if (outcome.kind !== "success") throw new Error("Invalid onboarding outcome.");
      return { catalog_version: ONBOARDING_CATALOG_VERSION, created_goals: outcome.result.goals };
    },
  };
}
