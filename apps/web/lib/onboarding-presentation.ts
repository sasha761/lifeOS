import { goalDecimalSchema, LANGUAGE_LEVELS } from "@lifeos/contracts";
import type { DomainKey, OnboardingAnswers, OnboardingState, OnboardingStep, UserPreferences } from "@lifeos/contracts";
import { findOnboardingOption, LANGUAGE_LEVEL_UNIT_LABEL } from "@lifeos/domain/onboarding";
import type { OnboardingIssueField, OnboardingProposal } from "@lifeos/domain/onboarding";
import { plural } from "./dashboard-presentation.ts";
import { formatGoalNumber, goalUnitLabel } from "./goal-presentation.ts";
import { instantToLocalDate } from "./goal-time.ts";
import { formatDate } from "./user-preferences.ts";

/** Screens of the wizard (LFS-219, rhythm removed by LFS-222): spheres, one question per chosen sphere in registry order, summary. */
export function onboardingSteps(answers: Pick<OnboardingAnswers, "domains">): OnboardingStep[] {
  return ["domains", ...answers.domains, "summary"];
}
/** The step to show; a step that no longer exists (the sphere was deselected) falls back to the spheres. */
export function currentOnboardingStep(answers: OnboardingAnswers): OnboardingStep {
  return onboardingSteps(answers).includes(answers.step) ? answers.step : "domains";
}
export function isSphereStep(step: OnboardingStep): step is DomainKey {
  return step !== "domains" && step !== "summary";
}

export const DIRECTION_LABELS = { increase: "Увеличить до значения", decrease: "Уменьшить до значения" } as const;
const DIRECTION_SHORT = { increase: "Увеличить", decrease: "Уменьшить" } as const;
export const GOAL_FORMS = ["цель", "цели", "целей"] as const;

function number(value: string, locale: string): string {
  const parsed = goalDecimalSchema.safeParse(value);
  return parsed.success ? formatGoalNumber(parsed.data, locale) : "—";
}
const level = (value: string) => /^[1-6]$/.test(value) ? LANGUAGE_LEVELS[Number(value) - 1]! : "—";

/** «500 → 3 000 $», «0 → 3 тренировок в неделю», «уровень A2 → B1 (2 → 3)»; a value not typed yet is «—». */
export function proposalRange(draft: OnboardingProposal["draft"], locale: string): string {
  if (draft.unit === "custom" && draft.unit_label === LANGUAGE_LEVEL_UNIT_LABEL) {
    return `уровень ${level(draft.baseline)} → ${level(draft.target)} (${draft.baseline || "—"} → ${draft.target || "—"})`;
  }
  const unit = goalUnitLabel(draft);
  return `${number(draft.baseline, locale)} → ${number(draft.target, locale)}${unit ? ` ${unit}` : ""}`;
}
export function proposalDeadline(draft: OnboardingProposal["draft"], preferences: UserPreferences): string | null {
  return draft.due_at ? formatDate(new Date(draft.due_at), preferences) : null;
}
/** Summary line of mockup 27: «Увеличить · 500 → 3 000 $ · до 30.06.2027» or «· без срока». */
export function proposalLine(proposal: OnboardingProposal, preferences: UserPreferences, { direction = true } = {}): string {
  const deadline = proposalDeadline(proposal.draft, preferences);
  return [direction ? DIRECTION_SHORT[proposal.draft.direction] : null, proposalRange(proposal.draft, preferences.locale),
    deadline ? `до ${deadline}` : direction ? "без срока" : null].filter(Boolean).join(" · ");
}

/** Message next to the field a proposed goal needs fixed; the same rules as «Новая цель». */
export function issueMessage(field: OnboardingIssueField, proposal: Pick<OnboardingProposal, "domainKey" | "option" | "draft">): string {
  const option = proposal.option ? findOnboardingOption(proposal.domainKey, proposal.option) : null;
  const levels = option?.unit.kind === "level";
  switch (field) {
    case "subject":
      if (option?.key === "own") return "Напишите цель своими словами (до 120 символов).";
      if (option?.key === "other") return "Напишите, какой язык (до 40 символов).";
      return `Не длиннее ${option?.subject?.maxLength ?? 80} символов.`;
    case "unit": return "Выберите валюту: NOK или USD.";
    case "unit_label": return "Укажите единицу (до 40 символов) или выберите частую.";
    case "direction": return "Выберите, как считать прогресс.";
    case "due_at": return "Проверьте дату срока.";
    case "baseline":
      return levels ? "Выберите уровень сейчас." : proposal.draft.unit === "NOK" || proposal.draft.unit === "USD"
        ? "Укажите сумму: неотрицательное число, до 2 знаков после запятой." : "Укажите неотрицательное число.";
    case "target":
      if (levels) return "Выберите уровень выше нынешнего.";
      return proposal.draft.direction === "increase"
        ? "Цель должна быть больше значения «сейчас» и подходить единице."
        : "Цель должна быть меньше значения «сейчас» и подходить единице.";
  }
}


/**
 * Status chip of «Начальная настройка» in Settings (mockup 30, LFS-220): «пройдена 18.11.2026 · 4 цели», «не пройдена» or
 * «отклонена». N counts the goals the completed setup gave that are still in the account: goals of the wizard, or the
 * example goals still labelled «Пример» when the example was the choice; without any, only the date is shown.
 */
export function setupStatus(state: Pick<OnboardingState, "status" | "choice" | "completed_at" | "goals">, preferences: UserPreferences): { label: string; done: boolean } {
  if (state.status === "dismissed") return { label: "отклонена", done: false };
  if (state.status !== "completed" || state.completed_at === null) return { label: "не пройдена", done: false };
  const goals = state.choice === "example" ? state.goals.examples : state.goals.onboarding;
  const date = formatDate(new Date(state.completed_at), preferences);
  return { label: goals > 0 ? `пройдена ${date} · ${goals} ${plural(goals, ["цель", "цели", "целей"])}` : `пройдена ${date}`, done: true };
}

/** Calendar date of a deadline in the profile zone the wizard uses, for the native date field. */
export function deadlineDate(dueAt: string | null, timeZone: string): string {
  return dueAt ? instantToLocalDate(dueAt, timeZone) : "";
}
