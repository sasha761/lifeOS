import { DOMAIN_KEYS, domainKeySchema } from "@lifeos/contracts";
import type { DomainKey } from "@lifeos/contracts";

export type DomainLocale = "ru" | "en";
export type LocalizedDomainText = Readonly<Record<DomainLocale, string>>;
export type LifeDomain = Readonly<{
  key: DomainKey;
  name: LocalizedDomainText;
  description: LocalizedDomainText;
  status: "available" | "planned";
  /** Supports the common manual-goal model; does not promise an implemented goal editor. */
  available: boolean;
  /** A specialized tracker or integration is implemented. False for every sphere in Stage 2. */
  specializedAvailable: boolean;
  url: `/domains/${DomainKey}`;
}>;

const definitions = {
  languages: {
    name: { ru: "Языки", en: "Languages" },
    description: {
      ru: "Цели изучения языков и практики. Вы сами выбираете, что измерять.",
      en: "Goals for language learning and practice. You choose what to measure.",
    },
  },
  finance: {
    name: { ru: "Финансы", en: "Finance" },
    description: {
      ru: "Цели накоплений, расходов и погашения долгов на основе ваших записей.",
      en: "Goals for savings, spending and debt repayment based on your own records.",
    },
  },
  work: {
    name: { ru: "Работа", en: "Work" },
    description: {
      ru: "Профессиональные цели и рабочие результаты, которые важны вам.",
      en: "Professional goals and work outcomes that matter to you.",
    },
  },
  projects: {
    name: { ru: "Проекты", en: "Projects" },
    description: {
      ru: "Цели личных проектов с понятными результатами и ручными измерениями.",
      en: "Personal project goals with clear outcomes and manual measurements.",
    },
  },
  skills: {
    name: { ru: "Навыки", en: "Skills" },
    description: {
      ru: "Цели обучения и практики навыков на основе того, что вы фиксируете сами.",
      en: "Goals for learning and practicing skills based on what you record yourself.",
    },
  },
  health: {
    name: { ru: "Здоровье", en: "Health" },
    description: {
      ru: "Личные цели активности и самочувствия с выбранными вами измерениями.",
      en: "Personal activity and wellbeing goals with measurements you choose.",
    },
  },
} satisfies Record<DomainKey, { name: LocalizedDomainText; description: LocalizedDomainText }>;

/** Code registry, not user data or a database table. Icons and styling belong to Web. */
export const LIFE_DOMAINS: readonly LifeDomain[] = Object.freeze(DOMAIN_KEYS.map((key): LifeDomain => Object.freeze({
  key,
  name: Object.freeze(definitions[key].name),
  description: Object.freeze(definitions[key].description),
  status: "available",
  available: true,
  specializedAvailable: false,
  url: `/domains/${key}`,
})));

/** Unknown input uses the same exact key validation as API contracts. Never indexes an object by raw input. */
export function findLifeDomain(value: unknown): LifeDomain | undefined {
  const parsed = domainKeySchema.safeParse(value);
  return parsed.success ? LIFE_DOMAINS.find((domain) => domain.key === parsed.data) : undefined;
}
