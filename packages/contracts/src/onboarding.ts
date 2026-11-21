import { z } from "zod";
import { DOMAIN_KEYS, domainKeySchema } from "./domains.ts";
import type { DomainKey } from "./domains.ts";
import { createGoalInputSchema, GOAL_UNIT_LABEL_MAX_LENGTH, goalDirectionSchema, goalInstantSchema, goalUnitSchema } from "./goals.ts";

/**
 * Onboarding wizard (LFS-219, ADR-012): spheres → one question per chosen sphere in registry order → rhythm → summary.
 * Version of the question catalog; answers saved with another version are not offered as a draft.
 */
export const ONBOARDING_CATALOG_VERSION = 1;
/** `dismissed` and the start `choice` are stored from LFS-219 on, so that the first-visit popup (LFS-220) needs no migration. */
export const ONBOARDING_STATUSES = Object.freeze(["not_started", "in_progress", "completed", "dismissed"] as const);
export const ONBOARDING_START_CHOICES = Object.freeze(["example", "wizard", "blank"] as const);
/** How often the person is ready to record progress (profile `checkin_rhythm`); reminders come with Telegram (Stage 3). */
export const CHECKIN_RHYTHMS = Object.freeze(["daily", "few_per_week", "weekly", "self"] as const);
/** Answer options of catalog v1 per sphere; `own`/`other` is the person's own wording. */
export const ONBOARDING_OPTIONS = Object.freeze({
  languages: ["english", "norwegian", "german", "spanish", "other"],
  finance: ["emergency_fund", "big_purchase", "debt", "invest", "spend_less", "own"],
  work: ["job_search", "course", "books", "practice", "own"],
  projects: ["launch", "finish", "regular", "own"],
  skills: ["chess", "programming", "instrument", "drawing", "own"],
  health: ["training", "weight", "sleep", "walk", "sweets", "own"],
} as const satisfies Record<DomainKey, readonly string[]>);
/** Health allows up to three choices (each becomes a goal), every other sphere one. */
export const ONBOARDING_CHOICE_LIMITS = Object.freeze({ languages: 1, finance: 1, work: 1, projects: 1, skills: 1, health: 3 } as const satisfies Record<DomainKey, number>);
/** «Свой вариант» becomes the goal title as written. */
export const ONBOARDING_OWN_TITLE_MAX_LENGTH = 120;
/** «Другой» language, written by the person. */
export const ONBOARDING_LANGUAGE_MAX_LENGTH = 40;
/** What the person saves for, the course, technology or project name inside a template title. */
export const ONBOARDING_NAME_MAX_LENGTH = 80;
/** Goals added on the summary in spheres that were not chosen («+ Добавить цель в другой сфере»). */
export const ONBOARDING_EXTRA_GOALS_MAX = 6;
/** Every goal the wizard can propose: one per sphere, three in Health and the extra goals. */
export const ONBOARDING_GOALS_MAX = Object.values(ONBOARDING_CHOICE_LIMITS).reduce((sum, limit) => sum + limit, 0) + ONBOARDING_EXTRA_GOALS_MAX;
/** A number as typed in a draft; it is validated only when goals are built («3 000», «21,1»). */
export const ONBOARDING_DRAFT_NUMBER_MAX_LENGTH = 40;
/** Language levels A1…C2 are stored as 1…6 in the unit «уровень (A1=1 … C2=6)». */
export const LANGUAGE_LEVELS = Object.freeze(["A1", "A2", "B1", "B2", "C1", "C2"] as const);
const TIME_ZONE_DRAFT_MAX_LENGTH = 64;

export const onboardingStatusSchema = z.enum(ONBOARDING_STATUSES);
export const onboardingStartChoiceSchema = z.enum(ONBOARDING_START_CHOICES);
export const checkinRhythmSchema = z.enum(CHECKIN_RHYTHMS);
export type OnboardingStatus = z.infer<typeof onboardingStatusSchema>;
export type CheckinRhythm = z.infer<typeof checkinRhythmSchema>;
/** Screen to resume on: the spheres, a chosen sphere's question, the rhythm or the summary. */
export const onboardingStepSchema = z.union([z.enum(["domains", "rhythm", "summary"]), domainKeySchema]);
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;
/** Proposed goal: `<sphere>.<option>` for an answer, `extra.<n>` for a goal added on the summary. */
export const onboardingGoalKeySchema = z.string().min(3).max(64).regex(/^[a-z]+\.[a-z0-9_]+$/);

const unique = (values: readonly string[]) => new Set(values).size === values.length;

/**
 * One chosen option with what the person typed. A draft may be unfinished (empty or malformed numbers), so values are
 * plain strings here; the goal built from them passes the creation contract before anything is stored as a goal.
 * `subject` is the own title, the «Другой» language or a name inside a template title; `direction` and `unit` matter for
 * «Свой вариант» (and the currency for finance), `unit_label` for an own custom unit.
 */
export const onboardingChoiceSchema = z.strictObject({
  option: z.string().min(1).max(32).regex(/^[a-z_]+$/),
  subject: z.string().max(ONBOARDING_OWN_TITLE_MAX_LENGTH),
  direction: goalDirectionSchema,
  unit: goalUnitSchema,
  unit_label: z.string().max(GOAL_UNIT_LABEL_MAX_LENGTH),
  baseline: z.string().max(ONBOARDING_DRAFT_NUMBER_MAX_LENGTH),
  target: z.string().max(ONBOARDING_DRAFT_NUMBER_MAX_LENGTH),
  due_at: goalInstantSchema.nullable(),
});
export type OnboardingChoice = z.infer<typeof onboardingChoiceSchema>;
/** Answer of one sphere; a skipped question keeps its choices, so «Ответить сейчас» returns to them. */
export const onboardingSphereAnswerSchema = z.strictObject({
  skipped: z.boolean(),
  choices: z.array(onboardingChoiceSchema).max(Math.max(...Object.values(ONBOARDING_CHOICE_LIMITS))),
});
export type OnboardingSphereAnswer = z.infer<typeof onboardingSphereAnswerSchema>;

/**
 * The whole draft (`onboarding_state.answers`). Answers of a sphere that was deselected are kept, so going back and
 * choosing it again loses nothing; only chosen spheres produce goals. `timezone` is the zone confirmed on the rhythm
 * step (null: the profile zone stays); `unchecked` are proposed goals unticked on the summary.
 */
export const onboardingAnswersSchema = z.strictObject({
  step: onboardingStepSchema,
  domains: z.array(domainKeySchema).max(DOMAIN_KEYS.length),
  spheres: z.partialRecord(domainKeySchema, onboardingSphereAnswerSchema),
  rhythm: checkinRhythmSchema.nullable(),
  timezone: z.string().min(1).max(TIME_ZONE_DRAFT_MAX_LENGTH).nullable(),
  extra: z.array(createGoalInputSchema).max(ONBOARDING_EXTRA_GOALS_MAX),
  unchecked: z.array(onboardingGoalKeySchema).max(ONBOARDING_GOALS_MAX),
}).superRefine((answers, context) => {
  // Registry order without repeats: the order of questions and of «сферы в фокусе» on the dashboard.
  if (!answers.domains.every((key, index) => index === 0 || DOMAIN_KEYS.indexOf(answers.domains[index - 1]!) < DOMAIN_KEYS.indexOf(key))) {
    context.addIssue({ code: "custom", path: ["domains"], message: "Spheres must be unique and in registry order." });
  }
  if (DOMAIN_KEYS.some((key) => key === answers.step) && !answers.domains.includes(answers.step as DomainKey)) {
    context.addIssue({ code: "custom", path: ["step"], message: "The step must be a chosen sphere." });
  }
  for (const key of DOMAIN_KEYS) {
    const sphere = answers.spheres[key];
    if (!sphere) continue;
    const options: readonly string[] = ONBOARDING_OPTIONS[key];
    const chosen = sphere.choices.map((choice) => choice.option);
    if (sphere.choices.length > ONBOARDING_CHOICE_LIMITS[key] || !unique(chosen) || !chosen.every((option) => options.includes(option))) {
      context.addIssue({ code: "custom", path: ["spheres", key], message: "Unknown, repeated or too many options." });
    }
  }
  if (!unique(answers.unchecked)) context.addIssue({ code: "custom", path: ["unchecked"], message: "Repeated goal key." });
});
export type OnboardingAnswers = z.infer<typeof onboardingAnswersSchema>;

/** PUT /api/v1/onboarding: replaces the draft («Сохранить и выйти»); no goal is created. */
export const saveOnboardingDraftInputSchema = z.strictObject({ answers: onboardingAnswersSchema });
export type SaveOnboardingDraftInput = z.infer<typeof saveOnboardingDraftInputSchema>;
/**
 * POST /api/v1/onboarding/complete («Создать N целей»): the answers and the ticked goals. The server builds the goals
 * from the answers again; one invalid goal rejects all of them and the error names its key (`field`).
 */
export const completeOnboardingInputSchema = z.strictObject({
  answers: onboardingAnswersSchema,
  selected: z.array(onboardingGoalKeySchema).min(1).max(ONBOARDING_GOALS_MAX).refine(unique),
});
export type CompleteOnboardingInput = z.infer<typeof completeOnboardingInputSchema>;

/** GET/PUT /api/v1/onboarding. Without a row the status is `not_started`; a draft of another catalog version reads as none. */
export const onboardingStateSchema = z.strictObject({
  status: onboardingStatusSchema,
  choice: onboardingStartChoiceSchema.nullable(),
  catalog_version: z.literal(ONBOARDING_CATALOG_VERSION),
  answers: onboardingAnswersSchema.nullable(),
  completed_at: goalInstantSchema.nullable(),
  updated_at: goalInstantSchema.nullable(),
  // A later draft (повторная настройка) keeps the time of the last completion.
}).refine((state) => state.status !== "completed" || state.completed_at !== null);
export type OnboardingState = z.infer<typeof onboardingStateSchema>;
/** A retry with the same Idempotency-Key returns the same count and creates nothing. */
export const onboardingCompletedSchema = z.strictObject({
  catalog_version: z.literal(ONBOARDING_CATALOG_VERSION),
  created_goals: z.number().int().min(1).max(ONBOARDING_GOALS_MAX),
});
export type OnboardingCompleted = z.infer<typeof onboardingCompletedSchema>;
