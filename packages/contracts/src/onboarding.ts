import { z } from "zod";
import { DOMAIN_KEYS, domainKeySchema } from "./domains.ts";
import type { DomainKey } from "./domains.ts";
import { createNumericGoalInputSchema, GOAL_UNIT_LABEL_MAX_LENGTH, goalDirectionSchema, goalInstantSchema, goalUnitSchema } from "./goals.ts";

/**
 * Onboarding wizard (LFS-219, ADR-012): spheres → one question per chosen sphere in registry order → summary. The
 * rhythm step was removed by LFS-222.
 * Version of the question catalog; answers saved with another version are not offered as a draft.
 */
export const ONBOARDING_CATALOG_VERSION = 1;
/** `dismissed` and the start `choice` are stored from LFS-219 on, so that the first-visit popup (LFS-220) needs no migration. */
export const ONBOARDING_STATUSES = Object.freeze(["not_started", "in_progress", "completed", "dismissed"] as const);
export const ONBOARDING_START_CHOICES = Object.freeze(["example", "wizard", "blank"] as const);
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

export const onboardingStatusSchema = z.enum(ONBOARDING_STATUSES);
export const onboardingStartChoiceSchema = z.enum(ONBOARDING_START_CHOICES);
export type OnboardingStatus = z.infer<typeof onboardingStatusSchema>;
/**
 * «Сферы в фокусе» (`user.focus_domains`, LFS-219): registry keys without repeats, in registry order. Older fixtures
 * without the field read as none.
 */
export const focusDomainsSchema = z.array(domainKeySchema).max(DOMAIN_KEYS.length)
  .refine((keys) => keys.every((key, index) => index === 0 || DOMAIN_KEYS.indexOf(keys[index - 1]!) < DOMAIN_KEYS.indexOf(key)));
const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Screen to resume on: the spheres, a chosen sphere's question or the summary. */
export const onboardingStepSchema = z.union([z.enum(["domains", "summary"]), domainKeySchema]);
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
 * choosing it again loses nothing; only chosen spheres produce goals. `unchecked` are proposed goals unticked on the
 * summary. Dates are read in the profile time zone. A draft stored before LFS-222 also had `rhythm` and `timezone`:
 * the server drops them when it reads the stored draft (`readStoredOnboardingAnswers`).
 */
export const onboardingAnswersSchema = z.strictObject({
  step: onboardingStepSchema,
  domains: z.array(domainKeySchema).max(DOMAIN_KEYS.length),
  spheres: z.partialRecord(domainKeySchema, onboardingSphereAnswerSchema),
  extra: z.array(createNumericGoalInputSchema).max(ONBOARDING_EXTRA_GOALS_MAX),
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

/**
 * GET/PUT/PATCH /api/v1/onboarding. Without a row the status is `not_started`; a draft of another catalog version reads
 * as none. Since LFS-220 it also carries what the setup keeps in the profile («сферы в фокусе») and three goal
 * counts of the owner for Settings and the popup: all goals, goals of the wizard (`origin = onboarding`) and goals
 * still labelled «Пример» (`origin = starter`), active and archived.
 */
export const onboardingStateSchema = z.strictObject({
  status: onboardingStatusSchema,
  choice: onboardingStartChoiceSchema.nullable(),
  catalog_version: z.literal(ONBOARDING_CATALOG_VERSION),
  answers: onboardingAnswersSchema.nullable(),
  completed_at: goalInstantSchema.nullable(),
  updated_at: goalInstantSchema.nullable(),
  focus_domains: focusDomainsSchema,
  goals: z.strictObject({ total: countSchema, onboarding: countSchema, examples: countSchema })
    .refine((goals) => goals.onboarding + goals.examples <= goals.total),
  // A later draft (повторная настройка) keeps the time of the last completion.
}).refine((state) => state.status !== "completed" || state.completed_at !== null);
export type OnboardingState = z.infer<typeof onboardingStateSchema>;

/**
 * Start choices of the first-visit popup (LFS-220) and the state each leads to: «Начать настройку» → `in_progress`,
 * «Начать с чистого листа» → `dismissed`. «Заполнить примером» has no transition of its own: loading the example
 * completes a setup that is not completed yet, in the same transaction (`POST /api/v1/starter-pack`).
 */
export const ONBOARDING_START_TRANSITIONS = Object.freeze({ wizard: "in_progress", blank: "dismissed" } as const);
/**
 * PATCH /api/v1/onboarding (LFS-220): a start choice of the popup, the pair of status and choice. Repeating the current
 * choice changes nothing, so no Idempotency-Key is needed. The rhythm from Settings was removed by LFS-222.
 */
export const updateOnboardingInputSchema = z.union([
  z.strictObject({ status: z.literal(ONBOARDING_START_TRANSITIONS.wizard), choice: z.literal("wizard") }),
  z.strictObject({ status: z.literal(ONBOARDING_START_TRANSITIONS.blank), choice: z.literal("blank") }),
]);
export type UpdateOnboardingInput = z.infer<typeof updateOnboardingInputSchema>;
export type OnboardingStartChoice = keyof typeof ONBOARDING_START_TRANSITIONS;
/** A retry with the same Idempotency-Key returns the same count and creates nothing. */
export const onboardingCompletedSchema = z.strictObject({
  catalog_version: z.literal(ONBOARDING_CATALOG_VERSION),
  created_goals: z.number().int().min(1).max(ONBOARDING_GOALS_MAX),
});
export type OnboardingCompleted = z.infer<typeof onboardingCompletedSchema>;
