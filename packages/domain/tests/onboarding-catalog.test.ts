import { describe, expect, it } from "vitest";
import { createGoalInputSchema, createNumericGoalInputSchema, DOMAIN_KEYS, ONBOARDING_CHOICE_LIMITS, ONBOARDING_OPTIONS, onboardingAnswersSchema } from "@lifeos/contracts";
import type { DomainKey, OnboardingAnswers, OnboardingChoice } from "@lifeos/contracts";
import {
  buildOnboardingGoals, emptyOnboardingAnswers, findOnboardingOption, LANGUAGE_LEVEL_UNIT_LABEL, newOnboardingChoice, ONBOARDING_QUESTIONS,
  onboardingDecimal, selectedOnboardingGoals, titleNumber,
} from "../src/core/onboarding-catalog.ts";

const due = "2027-06-30T21:59:59.999Z";
function answers(domains: DomainKey[], spheres: OnboardingAnswers["spheres"], extra: OnboardingAnswers["extra"] = []): OnboardingAnswers {
  return onboardingAnswersSchema.parse({ ...emptyOnboardingAnswers(), domains, spheres, extra });
}
const choice = (domainKey: DomainKey, option: string, values: Partial<OnboardingChoice> = {}): OnboardingChoice => ({ ...newOnboardingChoice(domainKey, option), ...values });
/** Numbers a person could type for the template: a level pair, a decrease or an increase. */
function valid(domainKey: DomainKey, option: string): OnboardingChoice {
  const template = findOnboardingOption(domainKey, option)!;
  const numbers = template.unit.kind === "level" ? { baseline: "2", target: "4" } : template.direction === "decrease" ? { baseline: "90", target: "0" } : { baseline: "0", target: "12" };
  const own = template.unit.kind === "own" ? { subject: "Своя цель", unit: "custom" as const, unit_label: "раз" } : {};
  const named = template.subject?.required ? { subject: "Итальянский" } : {};
  return choice(domainKey, option, { ...numbers, ...own, ...named, due_at: due });
}

describe("question catalog v1 (LFS-219)", () => {
  it("has a question for every sphere in registry order with the options and limits of the contract", () => {
    expect(Object.keys(ONBOARDING_QUESTIONS)).toEqual([...DOMAIN_KEYS]);
    for (const key of DOMAIN_KEYS) {
      const question = ONBOARDING_QUESTIONS[key];
      expect(question.options.map((option) => option.key)).toEqual([...ONBOARDING_OPTIONS[key]]);
      expect(question.limit).toBe(ONBOARDING_CHOICE_LIMITS[key]);
      expect(question.question).toMatch(/\?$/);
      expect(question.summary.length).toBeGreaterThan(0);
      // Every question lets the person answer in their own words.
      expect(question.options.some((option) => option.key === "own" || option.key === "other")).toBe(true);
    }
    expect(ONBOARDING_QUESTIONS.health.layout).toBe("tiles");
    expect(ONBOARDING_QUESTIONS.languages.layout).toBe("chips");
  });

  it("turns every template with valid numbers into a goal that passes the public creation contract", () => {
    for (const key of DOMAIN_KEYS) {
      for (const option of ONBOARDING_OPTIONS[key]) {
        const [proposal] = buildOnboardingGoals(answers([key], { [key]: { skipped: false, choices: [valid(key, option)] } }));
        expect(proposal?.issues, `${key}.${option}`).toEqual([]);
        expect(createGoalInputSchema.safeParse(proposal?.input).success, `${key}.${option}`).toBe(true);
        expect(proposal?.input).toMatchObject({ domain_key: key, due_at: due, calculation_mode: "manual", metric_key: null });
      }
    }
  });

  it("counts money in NOK or USD, debt and spending downwards, languages as levels 1…6", () => {
    const build = (key: DomainKey, value: OnboardingChoice) => buildOnboardingGoals(answers([key], { [key]: { skipped: false, choices: [value] } }))[0]!;
    expect(build("finance", choice("finance", "emergency_fund", { unit: "USD", target: "3 000", baseline: "500" })).input)
      .toMatchObject({ title: "Подушка безопасности", unit: "USD", unit_label: null, baseline: "500", target: "3000", direction: "increase" });
    expect(build("finance", choice("finance", "debt", { unit: "NOK", baseline: "120000" })).input).toMatchObject({ title: "Закрыть долг", direction: "decrease", target: "0" });
    expect(build("finance", choice("finance", "spend_less", { unit: "NOK", baseline: "20000", target: "15000" })).input?.direction).toBe("decrease");
    expect(build("finance", choice("finance", "emergency_fund", { unit: "count", target: "10" })).issues).toContain("unit");
    expect(build("finance", choice("finance", "big_purchase", { unit: "NOK", subject: "отпуск", target: "30000" })).input?.title).toBe("Накопить на отпуск");
    const norwegian = build("languages", choice("languages", "norwegian", { baseline: "2", target: "3" }));
    expect(norwegian.input).toMatchObject({ title: "Норвежский до B1", unit: "custom", unit_label: LANGUAGE_LEVEL_UNIT_LABEL, baseline: "2", target: "3" });
    expect(build("languages", choice("languages", "other", { subject: "итальянский", baseline: "1", target: "6" })).input?.title).toBe("Итальянский до C2");
    expect(build("languages", choice("languages", "other", { subject: "", baseline: "1", target: "2" })).issues).toContain("subject");
    expect(build("languages", choice("languages", "english", { baseline: "2.5", target: "7" })).issues).toEqual(expect.arrayContaining(["baseline", "target"]));
    expect(build("languages", choice("languages", "english", { baseline: "4", target: "3" })).issues).toContain("target");
  });

  it("keeps «Свой вариант» as written: the title, the chosen direction and unit, and checks it like a manual goal", () => {
    const own = (values: Partial<OnboardingChoice>) => buildOnboardingGoals(answers(["health"], { health: { skipped: false, choices: [choice("health", "own", values)] } }))[0]!;
    const run = own({ subject: "  Пробежать полумарафон  ", unit_label: "км за пробежку", baseline: "5", target: "21,1" });
    expect(run).toMatchObject({ key: "health.own", source: "own", issues: [] });
    expect(run.input).toMatchObject({ title: "Пробежать полумарафон", unit: "custom", unit_label: "км за пробежку", baseline: "5", target: "21.1" });
    expect(own({ subject: "Вес", direction: "decrease", unit: "custom", unit_label: "кг", baseline: "80", target: "75" }).input?.direction).toBe("decrease");
    expect(own({ subject: "Минуты", unit: "minutes", baseline: "0", target: "600" }).input).toMatchObject({ unit: "minutes", unit_label: null });
    expect(own({ subject: "", unit_label: "км", baseline: "0", target: "5" }).issues).toContain("subject");
    expect(own({ subject: "Цель", unit_label: "", baseline: "0", target: "5" }).issues).toContain("unit_label");
    expect(own({ subject: "Цель", unit_label: "км", baseline: "5", target: "5" }).issues).toContain("target");
    expect(own({ subject: "Цель", unit_label: "км", baseline: "-1", target: "5" }).issues).toContain("baseline");
    expect(own({ subject: "Цель", unit_label: "км", baseline: "0", target: "5" }).input).not.toBeNull();
  });

  it("builds up to three Health goals, skips skipped and unchosen spheres, and adds the extra goals last", () => {
    const extra = createNumericGoalInputSchema.parse({ domain_key: "work", title: "Отклики", unit: "count", baseline: "0", target: "10", direction: "increase" });
    const proposals = buildOnboardingGoals(answers(["finance", "skills", "health"], {
      finance: { skipped: false, choices: [valid("finance", "invest")] },
      skills: { skipped: true, choices: [valid("skills", "chess")] },
      health: { skipped: false, choices: [valid("health", "training"), valid("health", "sleep"), valid("health", "own")] },
      work: { skipped: false, choices: [valid("work", "books")] },
    }, [extra]));
    expect(proposals.map((proposal) => proposal.key)).toEqual(["finance.invest", "health.training", "health.sleep", "health.own", "extra.0"]);
    expect(proposals.at(-1)).toMatchObject({ source: "extra", domainKey: "work", input: extra });
    const ticked = selectedOnboardingGoals({ ...answers(["health"], { health: { skipped: false, choices: [valid("health", "training"), choice("health", "weight")] } }), unchecked: [] });
    // An unfinished choice (no numbers yet) is not ticked; an unticked one neither.
    expect(ticked.map((proposal) => proposal.key)).toEqual(["health.training"]);
    const unticked = answers(["health"], { health: { skipped: false, choices: [valid("health", "training")] } });
    expect(selectedOnboardingGoals({ ...unticked, unchecked: ["health.training"] })).toEqual([]);
  });

  it("writes the target into a title with Russian plurals and never invents a number", () => {
    const title = (key: DomainKey, option: string, target: string) => findOnboardingOption(key, option)!.title({ subject: "", target });
    expect(title("health", "training", "3")).toBe("Тренировки 3 раза в неделю");
    expect(title("health", "training", "5")).toBe("Тренировки 5 раз в неделю");
    expect(title("health", "training", "1")).toBe("Тренировки 1 раз в неделю");
    expect(title("work", "books", "1")).toBe("Прочитать 1 книгу по профессии");
    expect(title("work", "books", "6")).toBe("Прочитать 6 книг по профессии");
    expect(title("health", "walk", "10000")).toBe("Ходить 10 000 шагов в день");
    expect(title("health", "training", "abc")).toBe("Регулярные тренировки");
    expect(titleNumber("21.1")).toBe("21,1");
    expect(onboardingDecimal(" 3 000,5 ")).toBe("3000.5");
  });

  it("starts a new choice with the template's prefilled values and NOK for money", () => {
    expect(newOnboardingChoice("finance", "emergency_fund")).toMatchObject({ unit: "NOK", baseline: "0", target: "", direction: "increase" });
    expect(newOnboardingChoice("finance", "debt")).toMatchObject({ baseline: "", target: "0", direction: "decrease" });
    expect(newOnboardingChoice("health", "own")).toMatchObject({ unit: "custom", unit_label: "", direction: "increase" });
    expect(onboardingAnswersSchema.safeParse({ ...emptyOnboardingAnswers(), domains: ["finance"], spheres: { finance: { skipped: false, choices: [newOnboardingChoice("finance", "debt")] } } }).success).toBe(true);
  });
});
