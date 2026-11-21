import type { Metadata } from "next";
import { LIFE_DOMAINS } from "@lifeos/domain";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { timeZoneOptions } from "@/lib/user-preferences";
import { requirePageSession } from "@/server/auth";
import { getOnboardingService, getUserPreferencesService } from "@/server/core";

export const metadata: Metadata = { title: "Начальная настройка" };

// Plain labels for the client view: the domain registry itself stays on the server.
const labels = Object.fromEntries(LIFE_DOMAINS.map((domain) => [domain.key, domain.name.ru])) as Record<(typeof LIFE_DOMAINS)[number]["key"], string>;

/**
 * Onboarding wizard (LFS-219, mockups 24–27, 29). Its own route group: the wizard has its own top bar
 * («LifeOS / Начальная настройка», «Сохранить и выйти») instead of the site navigation; the URL stays /onboarding.
 * A saved draft continues on its step; after a completion the past answers are offered again from the first step.
 */
export default async function OnboardingPage() {
  const { actor } = await requirePageSession("/onboarding");
  const [state, preferences] = await Promise.all([getOnboardingService().get(actor), getUserPreferencesService().get(actor)]);
  return <OnboardingWizard initial={state} preferences={preferences} labels={labels} timeZones={timeZoneOptions(preferences.timezone)} />;
}
