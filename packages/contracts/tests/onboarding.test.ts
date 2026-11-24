import { describe, expect, it } from "vitest";
import {
  apiErrorSchema, completeOnboardingInputSchema, dashboardSchema, DOMAIN_KEYS, ONBOARDING_CHOICE_LIMITS, ONBOARDING_GOALS_MAX, ONBOARDING_OPTIONS,
  onboardingAnswersSchema, onboardingCompletedSchema, onboardingStateSchema, saveOnboardingDraftInputSchema, updateOnboardingInputSchema,
} from "../src/index.ts";

const time = "2026-11-20T10:00:00.000Z";
const choice = (option: string, values: Record<string, unknown> = {}) =>
  ({ option, subject: "", direction: "increase", unit: "custom", unit_label: "", baseline: "", target: "", due_at: null, ...values });
const empty = { step: "domains", domains: [], spheres: {}, extra: [], unchecked: [] };
const draft = {
  step: "health", domains: ["finance", "health"], unchecked: ["health.training"],
  extra: [{ domain_key: "work", title: "Отклики", unit: "count", baseline: "0", target: "10", direction: "increase" }],
  spheres: {
    finance: { skipped: false, choices: [choice("emergency_fund", { unit: "NOK", target: "3 000", baseline: "abc" })] },
    health: { skipped: false, choices: [choice("training"), choice("own", { subject: "Свой" })] },
  },
};

describe("onboarding draft (LFS-219)", () => {
  it("accepts an empty draft and an unfinished one: numbers are text until the goals are built", () => {
    expect(onboardingAnswersSchema.parse(empty)).toEqual(empty);
    const parsed = onboardingAnswersSchema.parse(draft);
    expect(parsed.spheres.finance?.choices[0]?.baseline).toBe("abc");
    expect(parsed.extra[0]).toMatchObject({ description: null, due_at: null, calculation_mode: "manual" });
    expect(saveOnboardingDraftInputSchema.parse({ answers: draft }).answers.step).toBe("health");
  });

  it("knows the options of catalog v1 and the choice limits: Health up to three, other spheres one", () => {
    expect(Object.keys(ONBOARDING_OPTIONS)).toEqual([...DOMAIN_KEYS]);
    expect(ONBOARDING_CHOICE_LIMITS).toEqual({ languages: 1, finance: 1, work: 1, projects: 1, skills: 1, health: 3 });
    expect(ONBOARDING_GOALS_MAX).toBe(8 + 6);
    const health = (choices: unknown[]) => onboardingAnswersSchema.safeParse({ ...empty, domains: ["health"], spheres: { health: { skipped: false, choices } } }).success;
    expect(health([choice("training"), choice("sleep"), choice("own")])).toBe(true);
    expect(health([choice("training"), choice("sleep"), choice("walk"), choice("own")])).toBe(false);
    expect(health([choice("training"), choice("training")])).toBe(false);
    expect(health([choice("emergency_fund")])).toBe(false);
    const finance = (choices: unknown[]) => onboardingAnswersSchema.safeParse({ ...empty, domains: ["finance"], spheres: { finance: { skipped: false, choices } } }).success;
    expect(finance([choice("debt"), choice("invest")])).toBe(false);
  });

  it("rejects spheres out of registry order, a step of a sphere that was not chosen and unknown fields", () => {
    expect(onboardingAnswersSchema.safeParse({ ...empty, domains: ["finance", "languages"] }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ ...empty, domains: ["finance", "finance"] }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ ...empty, step: "work", domains: ["finance"] }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ ...empty, step: "summary" }).success).toBe(true);
    expect(onboardingAnswersSchema.safeParse({ ...empty, user_id: "other" }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ ...empty, spheres: { sports: { skipped: false, choices: [] } } }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ ...draft, spheres: { ...draft.spheres, finance: { skipped: false, choices: [{ ...choice("own"), extra: 1 }] } } }).success).toBe(false);
  });

  it("has no rhythm step and no rhythm or zone in a new draft (LFS-222)", () => {
    expect(onboardingAnswersSchema.safeParse({ ...empty, step: "rhythm" }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ ...empty, rhythm: "weekly" }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ ...empty, rhythm: null, timezone: null }).success).toBe(false);
    expect(saveOnboardingDraftInputSchema.safeParse({ answers: { ...draft, timezone: "Europe/Oslo" } }).success).toBe(false);
    expect(completeOnboardingInputSchema.safeParse({ answers: { ...draft, rhythm: "weekly" }, selected: ["health.own"] }).success).toBe(false);
  });

  it("bounds what a draft can hold: own text 120, numbers 40 characters, six extra goals, valid instants only", () => {
    const own = (subject: string) => onboardingAnswersSchema.safeParse({ ...empty, domains: ["health"], spheres: { health: { skipped: false, choices: [choice("own", { subject })] } } }).success;
    expect(own("а".repeat(120))).toBe(true);
    expect(own("а".repeat(121))).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ ...draft, spheres: { finance: { skipped: false, choices: [choice("debt", { target: "1".repeat(41) })] } } }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ ...draft, spheres: { finance: { skipped: false, choices: [choice("debt", { due_at: "2027-06-30" })] } } }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ ...empty, extra: Array.from({ length: 7 }, () => draft.extra[0]) }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ ...empty, extra: [{ ...draft.extra[0], target: "0" }] }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ ...empty, unchecked: ["health.own", "health.own"] }).success).toBe(false);
  });
});

describe("completion and state DTOs (LFS-219)", () => {
  it("requires at least one ticked goal, each once, by its key", () => {
    expect(completeOnboardingInputSchema.parse({ answers: draft, selected: ["finance.emergency_fund", "extra.0"] }).selected).toHaveLength(2);
    expect(completeOnboardingInputSchema.safeParse({ answers: draft, selected: [] }).success).toBe(false);
    expect(completeOnboardingInputSchema.safeParse({ answers: draft, selected: ["health.own", "health.own"] }).success).toBe(false);
    expect(completeOnboardingInputSchema.safeParse({ answers: draft, selected: ["Health own"] }).success).toBe(false);
    expect(completeOnboardingInputSchema.safeParse({ answers: draft, selected: ["health.own"], user_id: "other" }).success).toBe(false);
  });

  it("describes the state: a completed setup has its time, a later draft keeps it", () => {
    const state = { status: "completed", choice: "wizard", catalog_version: 1, answers: null, completed_at: time, updated_at: time,
      focus_domains: [], goals: { total: 0, onboarding: 0, examples: 0 } };
    expect(onboardingStateSchema.parse(state).status).toBe("completed");
    expect(onboardingStateSchema.safeParse({ ...state, completed_at: null }).success).toBe(false);
    expect(onboardingStateSchema.parse({ ...state, status: "in_progress" }).completed_at).toBe(time);
    expect(onboardingStateSchema.safeParse({ ...state, catalog_version: 2 }).success).toBe(false);
    expect(onboardingStateSchema.safeParse({ ...state, choice: "robot" }).success).toBe(false);
    expect(onboardingCompletedSchema.safeParse({ catalog_version: 1, created_goals: 0 }).success).toBe(false);
    expect(onboardingCompletedSchema.parse({ catalog_version: 1, created_goals: 4 }).created_goals).toBe(4);
  });

  it("lets an API error name the rejected item by a fixed key, never by free text", () => {
    expect(apiErrorSchema.parse({ code: "VALIDATION_ERROR", message: "Invalid request.", field: "health.own" }).field).toBe("health.own");
    expect(apiErrorSchema.parse({ code: "VALIDATION_ERROR", message: "Invalid request." }).field).toBeUndefined();
    expect(apiErrorSchema.safeParse({ code: "VALIDATION_ERROR", message: "Invalid request.", field: "Пробежать полумарафон" }).success).toBe(false);
  });

  it("adds «сферы в фокусе» to the dashboard in registry order; older payloads read as none", () => {
    const dashboard = { domains: DOMAIN_KEYS.map((key) => ({ key, activeCount: 0, archivedCount: 0, goals: [] })), today: { dueGoals: [] }, activity: [], examples: { goals: 0, measurements: 0 } };
    expect(dashboardSchema.parse(dashboard).focus_domains).toEqual([]);
    expect(dashboardSchema.parse({ ...dashboard, focus_domains: ["finance", "health"] }).focus_domains).toEqual(["finance", "health"]);
    expect(dashboardSchema.safeParse({ ...dashboard, focus_domains: ["health", "finance"] }).success).toBe(false);
    expect(dashboardSchema.safeParse({ ...dashboard, focus_domains: ["sports"] }).success).toBe(false);
  });
});

describe("first-visit popup and Settings (LFS-220)", () => {
  const settings = { status: "completed", choice: "example", catalog_version: 1, answers: null, completed_at: time, updated_at: time,
    focus_domains: ["finance", "health"], goals: { total: 9, onboarding: 0, examples: 7 } };

  it("accepts exactly a start choice of the popup; the rhythm from Settings is gone (LFS-222)", () => {
    expect(updateOnboardingInputSchema.parse({ status: "in_progress", choice: "wizard" })).toEqual({ status: "in_progress", choice: "wizard" });
    expect(updateOnboardingInputSchema.parse({ status: "dismissed", choice: "blank" })).toEqual({ status: "dismissed", choice: "blank" });
    // The example completes the setup through POST /api/v1/starter-pack; no pair moves to completed or back to not started.
    for (const input of [{ status: "completed", choice: "example" }, { status: "in_progress", choice: "blank" }, { status: "dismissed", choice: "wizard" },
      { status: "not_started", choice: null }, { choice: "wizard" }, { checkin_rhythm: "few_per_week" }, { checkin_rhythm: null },
      { checkin_rhythm: "weekly", status: "dismissed", choice: "blank" }, { status: "dismissed", choice: "blank", user_id: "other" }, {}]) {
      expect(updateOnboardingInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("carries the spheres in focus in registry order and consistent goal counts, without the rhythm (LFS-222)", () => {
    expect(onboardingStateSchema.parse(settings).goals).toEqual({ total: 9, onboarding: 0, examples: 7 });
    expect(onboardingStateSchema.safeParse({ ...settings, goals: { total: 3, onboarding: 2, examples: 2 } }).success).toBe(false);
    expect(onboardingStateSchema.safeParse({ ...settings, focus_domains: ["health", "finance"] }).success).toBe(false);
    expect(onboardingStateSchema.safeParse({ ...settings, checkin_rhythm: "weekly" }).success).toBe(false);
    expect(onboardingStateSchema.safeParse({ ...settings, goals: undefined }).success).toBe(false);
  });

  it("lets the dashboard show the popup only for an empty account whose setup is open; older payloads show none", () => {
    const account = { domains: DOMAIN_KEYS.map((key) => ({ key, activeCount: 0, archivedCount: 0, goals: [] })), today: { dueGoals: [] }, activity: [], examples: { goals: 0, measurements: 0 } };
    expect(dashboardSchema.parse(account).onboarding).toEqual({ status: "not_started", show_start: false });
    expect(dashboardSchema.parse({ ...account, onboarding: { status: "in_progress", show_start: true } }).onboarding.show_start).toBe(true);
    expect(dashboardSchema.safeParse({ ...account, onboarding: { status: "dismissed", show_start: true } }).success).toBe(false);
    const archived = { ...account, domains: account.domains.map((domain) => domain.key === "work" ? { ...domain, archivedCount: 1 } : domain) };
    expect(dashboardSchema.safeParse({ ...archived, onboarding: { status: "not_started", show_start: true } }).success).toBe(false);
    expect(dashboardSchema.parse({ ...archived, onboarding: { status: "not_started", show_start: false } }).onboarding.show_start).toBe(false);
  });
});
