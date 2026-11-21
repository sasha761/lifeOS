import { describe, expect, it } from "vitest";
import { onboardingAnswersSchema } from "@lifeos/contracts";
import { buildOnboardingGoals, newOnboardingChoice } from "@lifeos/domain/onboarding";
import { currentOnboardingStep, focusLabel, issueMessage, moveDeadlines, onboardingSteps, proposalLine, proposalRange, setupStatus } from "../lib/onboarding-presentation.ts";

const preferences = { timezone: "Europe/Oslo", locale: "ru" };
const base = { step: "domains", domains: ["languages", "finance"], spheres: {}, rhythm: null, timezone: null, extra: [], unchecked: [] };

describe("onboarding wizard presentation (LFS-219)", () => {
  it("builds the step scale from the chosen spheres: 4 to 9 screens", () => {
    expect(onboardingSteps({ domains: ["finance"] })).toEqual(["domains", "finance", "rhythm", "summary"]);
    expect(onboardingSteps({ domains: ["languages", "finance", "work", "projects", "skills", "health"] })).toHaveLength(9);
    // A step of a sphere that was deselected falls back to the first screen.
    expect(currentOnboardingStep({ ...onboardingAnswersSchema.parse(base), step: "health" })).toBe("domains");
    expect(currentOnboardingStep(onboardingAnswersSchema.parse({ ...base, step: "finance" }))).toBe("finance");
  });

  it("shows a proposed goal as on mockups 25 and 27, with levels for a language and «—» for a value not typed yet", () => {
    const answers = onboardingAnswersSchema.parse({ ...base, spheres: {
      languages: { skipped: false, choices: [{ ...newOnboardingChoice("languages", "norwegian"), baseline: "2", target: "3", due_at: "2027-05-31T21:59:59.999Z" }] },
      finance: { skipped: false, choices: [{ ...newOnboardingChoice("finance", "emergency_fund"), unit: "USD", baseline: "500", target: "" }] },
    } });
    const [language, money] = buildOnboardingGoals(answers);
    expect(proposalRange(language!.draft, "ru")).toBe("уровень A2 → B1 (2 → 3)");
    expect(proposalLine(language!, preferences)).toBe("Увеличить · уровень A2 → B1 (2 → 3) · до 31.05.2027");
    expect(proposalLine(money!, preferences)).toBe("Увеличить · 500 → — $ · без срока");
    expect(proposalLine(money!, preferences, { direction: false })).toBe("500 → — $");
    expect(issueMessage("target", money!)).toMatch(/больше/);
    expect(focusLabel(1)).toBe("сначала 1 выбранная сфера");
    expect(focusLabel(4)).toBe("сначала 4 выбранные сферы");
  });

  it("keeps the chosen calendar dates when the zone changes on the rhythm step", () => {
    const answers = onboardingAnswersSchema.parse({ ...base, domains: ["finance"], spheres: {
      finance: { skipped: false, choices: [{ ...newOnboardingChoice("finance", "debt"), due_at: "2027-06-30T21:59:59.999Z" }] },
    }, extra: [{ domain_key: "work", title: "Отклики", unit: "count", baseline: "0", target: "5", direction: "increase", due_at: "2027-01-31T22:59:59.999Z" }] });
    const moved = moveDeadlines(answers, "Europe/Oslo", "UTC");
    expect(moved.spheres.finance?.choices[0]?.due_at).toBe("2027-06-30T23:59:59.999Z");
    expect(moved.extra[0]?.due_at).toBe("2027-01-31T23:59:59.999Z");
  });
});

describe("«Начальная настройка» in Settings (LFS-220)", () => {
  const goals = { total: 11, onboarding: 4, examples: 7 };
  const completedAt = "2026-11-18T23:30:00.000Z";
  it("names the status and counts the goals the completed setup gave that are still in the account", () => {
    // The date is the day in the account zone: 18.11 23:30 UTC is 19.11 00:30 in Oslo.
    expect(setupStatus({ status: "completed", choice: "wizard", completed_at: completedAt, goals }, preferences)).toEqual({ label: "пройдена 19.11.2026 · 4 цели", done: true });
    expect(setupStatus({ status: "completed", choice: "example", completed_at: completedAt, goals }, preferences).label).toBe("пройдена 19.11.2026 · 7 целей");
    expect(setupStatus({ status: "completed", choice: "example", completed_at: completedAt, goals: { ...goals, examples: 0 } }, preferences).label).toBe("пройдена 19.11.2026");
    expect(setupStatus({ status: "dismissed", choice: "blank", completed_at: null, goals }, preferences)).toEqual({ label: "отклонена", done: false });
    for (const status of ["not_started", "in_progress"] as const) expect(setupStatus({ status, choice: null, completed_at: null, goals }, preferences).label).toBe("не пройдена");
  });
});
