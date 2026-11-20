import {
  createGoalInputSchema, DOMAIN_KEYS, GOAL_UNIT_LABEL_MAX_LENGTH, goalDecimalSchema, LANGUAGE_LEVELS, ONBOARDING_CHOICE_LIMITS, ONBOARDING_LANGUAGE_MAX_LENGTH, ONBOARDING_NAME_MAX_LENGTH, ONBOARDING_OPTIONS, ONBOARDING_OWN_TITLE_MAX_LENGTH,
} from "@lifeos/contracts";
import type { CheckinRhythm, CreateGoalInput, DomainKey, Goal, OnboardingAnswers, OnboardingChoice } from "@lifeos/contracts";

/*
 * Question catalog v1 of the onboarding wizard (LFS-219, ADR-012, docs/reference/ui/ONBOARDING.md) as data, outside the
 * components. An option is a goal template: title, how progress is counted and the unit; the numbers come only from the
 * person. Pure module without services: the browser imports it through `@lifeos/domain/onboarding` for the live preview.
 */

/** Unit of a template: fixed, a currency the person picks (NOK/USD), a language level or the person's own unit. */
export type OnboardingUnitSpec =
  | { kind: "fixed"; unit: Goal["unit"]; unit_label: string | null }
  | { kind: "currency" }
  | { kind: "level" }
  | { kind: "own" };
/** One number field of «Уточните цифры»: which goal value it is, its caption and the prefilled value. */
export type OnboardingNumberField = { field: "baseline" | "target"; label: string; initial: string };
export type OnboardingSubjectField = { label: string; placeholder: string; required: boolean; maxLength: number };
export type OnboardingOption = {
  key: string;
  label: string;
  description: string | null;
  /** `own`: the person chooses «Увеличить» or «Уменьшить». */
  direction: Goal["direction"] | "own";
  unit: OnboardingUnitSpec;
  /** A text the title is made of: the own title, the language, a project or course name. */
  subject: OnboardingSubjectField | null;
  numbers: readonly [OnboardingNumberField, OnboardingNumberField];
  hint: string | null;
  /** Title of the goal from the subject and the target as typed; never invents a number. */
  title(values: { subject: string; target: string | null }): string;
};
export type OnboardingUnitHint = { unit: Goal["unit"]; unit_label: string | null };
export type OnboardingQuestion = {
  domainKey: DomainKey;
  /** Step 1 card: what the sphere covers. */
  summary: string;
  question: string;
  lead: string;
  limit: number;
  /** cards: two columns with a description; chips: languages; tiles: Health, several choices. */
  layout: "cards" | "chips" | "tiles";
  options: readonly OnboardingOption[];
  /** «Частые единицы» of «Свой вариант». */
  ownUnits: readonly OnboardingUnitHint[];
  /** Right panel note under «Что получится». */
  note: string | null;
};

export const LANGUAGE_LEVEL_UNIT_LABEL = "уровень (A1=1 … C2=6)";
const LEVEL = { kind: "level" } as const;
const CURRENCY = { kind: "currency" } as const;
const custom = (unit_label: string) => ({ kind: "fixed", unit: "custom", unit_label }) as const;
const COUNT = { kind: "fixed", unit: "count", unit_label: null } as const;
const NUMBERS_HINT = "Цифры можно поправить позже, пока у цели нет измерений.";
const now = (label = "Сейчас", initial = ""): OnboardingNumberField => ({ field: "baseline", label, initial });
const goal = (label = "Цель", initial = ""): OnboardingNumberField => ({ field: "target", label, initial });
const named = (label: string, placeholder: string, maxLength = ONBOARDING_NAME_MAX_LENGTH): OnboardingSubjectField =>
  ({ label, placeholder, required: false, maxLength });

/** Number as it appears inside a title: «10 000», «21,1»; null if the target is not a valid number yet. */
export function titleNumber(value: string | null): string | null {
  if (value === null) return null;
  const parsed = goalDecimalSchema.safeParse(value);
  if (!parsed.success) return null;
  const [integer = "0", fraction] = parsed.data.split(".");
  return new Intl.NumberFormat("ru").format(BigInt(integer)) + (fraction ? `,${fraction}` : "");
}
const pluralRules = new Intl.PluralRules("ru");
/** «3 раза», «5 раз», «2,5 раза»: Russian plural of a noun after a number. */
function counted(value: string | null, forms: { one: string; few: string; many: string; other: string }): string | null {
  const text = titleNumber(value);
  if (text === null) return null;
  const category = pluralRules.select(Number(value)) as keyof typeof forms;
  return `${text} ${forms[category] ?? forms.other}`;
}
const TIMES = { one: "раз", few: "раза", many: "раз", other: "раза" };
const HOURS = { one: "час", few: "часа", many: "часов", other: "часа" };
const quoted = (subject: string) => `«${subject}»`;

function own(note: string): OnboardingOption {
  return {
    key: "own", label: "Свой вариант", description: note, direction: "own", unit: { kind: "own" },
    subject: { label: "Свой вариант", placeholder: "Напишите цель так, как сказали бы себе", required: true, maxLength: ONBOARDING_OWN_TITLE_MAX_LENGTH },
    numbers: [now(), goal()], hint: NUMBERS_HINT, title: ({ subject }) => subject,
  };
}
function language(key: string, label: string): OnboardingOption {
  return {
    key, label, description: null, direction: "increase", unit: LEVEL, subject: null,
    numbers: [now("Ваш уровень сейчас"), goal("Хочу достичь")], hint: "Не знаете точно? Выберите ближе к правде, потом поправите.",
    title: ({ target }) => levelTitle(label, target),
  };
}
function levelTitle(language: string, target: string | null): string {
  const level = target === null ? undefined : LANGUAGE_LEVELS[Number(target) - 1];
  return level && /^[1-6]$/.test(target ?? "") ? `${language} до ${level}` : language;
}

/** Catalog v1, in registry order; the texts of ONBOARDING.md and mockups 24–29. */
export const ONBOARDING_QUESTIONS: Readonly<Record<DomainKey, OnboardingQuestion>> = Object.freeze({
  languages: {
    domainKey: "languages", summary: "уровень, слова, практика", question: "Какой язык вы учите и до какого уровня?",
    lead: "Выберите язык или напишите свой. Уровень станет числом от 1 до 6, так считается прогресс.", limit: ONBOARDING_CHOICE_LIMITS.languages,
    layout: "chips", ownUnits: [], note: null,
    options: [
      language("english", "Английский"), language("norwegian", "Норвежский"), language("german", "Немецкий"), language("spanish", "Испанский"),
      { ...language("other", "Другой"), subject: { label: "Какой язык", placeholder: "Например, итальянский", required: true, maxLength: ONBOARDING_LANGUAGE_MAX_LENGTH },
        title: ({ subject, target }) => levelTitle(subject ? subject.charAt(0).toLocaleUpperCase("ru") + subject.slice(1) : "Язык", target) },
    ],
  },
  finance: {
    domainKey: "finance", summary: "накопления, долги, расходы", question: "Какая у вас финансовая цель на ближайшие полгода?",
    lead: "Выберите один вариант или напишите свой.", limit: ONBOARDING_CHOICE_LIMITS.finance, layout: "cards",
    ownUnits: [{ unit: "NOK", unit_label: null }, { unit: "USD", unit_label: null }, { unit: "percent", unit_label: null }], note: null,
    options: [
      { key: "emergency_fund", label: "Создать подушку безопасности", description: "запас на несколько месяцев расходов", direction: "increase", unit: CURRENCY,
        subject: null, numbers: [goal("Сколько нужно"), now("Сколько уже есть", "0")],
        hint: `Подсказка: подушка обычно равна 3–6 месяцам ваших расходов. ${NUMBERS_HINT}`, title: () => "Подушка безопасности" },
      { key: "big_purchase", label: "Накопить на крупную покупку", description: "техника, отпуск, переезд", direction: "increase", unit: CURRENCY,
        subject: named("На что копите", "Например, отпуск"), numbers: [goal("Сколько нужно"), now("Сколько уже есть", "0")], hint: NUMBERS_HINT,
        title: ({ subject }) => subject ? `Накопить на ${subject}` : "Накопить на крупную покупку" },
      { key: "debt", label: "Закрыть долг или кредит", description: "сумма будет уменьшаться", direction: "decrease", unit: CURRENCY, subject: null,
        numbers: [now("Сколько осталось выплатить"), goal("До какой суммы", "0")], hint: `Прогресс — это уменьшение долга. ${NUMBERS_HINT}`,
        title: () => "Закрыть долг" },
      { key: "invest", label: "Начать инвестировать", description: "откладывать сумму каждый месяц", direction: "increase", unit: CURRENCY, subject: null,
        numbers: [goal("Сколько вложить"), now("Сколько уже вложено", "0")], hint: NUMBERS_HINT, title: () => "Начать инвестировать" },
      { key: "spend_less", label: "Тратить меньше в месяц", description: "потолок расходов", direction: "decrease", unit: CURRENCY, subject: null,
        numbers: [now("Сколько тратите в месяц"), goal("Сколько хотите тратить")], hint: `Отмечайте расходы за месяц. ${NUMBERS_HINT}`,
        title: () => "Тратить меньше в месяц" },
      own("напишите цель своими словами"),
    ],
  },
  work: {
    domainKey: "work", summary: "поиск работы, рост, обучение", question: "Что главное в работе на ближайшие полгода?",
    lead: "Выберите один вариант или напишите свой.", limit: ONBOARDING_CHOICE_LIMITS.work, layout: "cards",
    ownUnits: [{ unit: "custom", unit_label: "откликов" }, { unit: "custom", unit_label: "часов" }, { unit: "count", unit_label: null }, { unit: "custom", unit_label: "модулей" }], note: null,
    options: [
      { key: "job_search", label: "Найти новую работу", description: "считаем отправленные отклики", direction: "increase", unit: custom("откликов"), subject: null,
        numbers: [goal("Сколько откликов отправить"), now("Уже отправлено", "0")], hint: NUMBERS_HINT, title: () => "Найти новую работу" },
      { key: "course", label: "Пройти курс или сертификат", description: "считаем пройденные модули", direction: "increase", unit: custom("модулей"),
        subject: named("Какой курс", "Например, курс по SQL"), numbers: [goal("Сколько модулей всего"), now("Уже пройдено", "0")], hint: NUMBERS_HINT,
        title: ({ subject }) => subject ? `Пройти курс ${quoted(subject)}` : "Пройти курс или сертификат" },
      { key: "books", label: "Прочитать книги по профессии", description: "считаем прочитанные книги", direction: "increase", unit: COUNT, subject: null,
        numbers: [goal("Сколько книг"), now("Уже прочитано", "0")], hint: NUMBERS_HINT,
        title: ({ target }) => { const books = counted(target, { one: "книгу", few: "книги", many: "книг", other: "книги" }); return books ? `Прочитать ${books} по профессии` : "Прочитать книги по профессии"; } },
      { key: "practice", label: "Практика технологии", description: "считаем часы практики", direction: "increase", unit: custom("часов"),
        subject: named("Какой технологии", "Например, TypeScript"), numbers: [goal("Сколько часов"), now("Уже есть", "0")], hint: NUMBERS_HINT,
        title: ({ subject }) => subject ? `Практика ${subject}` : "Практика технологии" },
      own("напишите цель своими словами"),
    ],
  },
  projects: {
    domainKey: "projects", summary: "личные проекты и их этапы", question: "Какой личный проект вы хотите продвинуть?",
    lead: "Выберите один вариант или напишите свой. Проект делится на этапы — так видно, сколько осталось.", limit: ONBOARDING_CHOICE_LIMITS.projects, layout: "cards",
    ownUnits: [{ unit: "custom", unit_label: "этапов" }, { unit: "custom", unit_label: "публикаций в месяц" }, { unit: "count", unit_label: null }], note: null,
    options: [
      { key: "launch", label: "Запустить новый", description: "от идеи до запуска по этапам", direction: "increase", unit: custom("этапов"),
        subject: named("Название проекта", "Например, сайт-портфолио"), numbers: [goal("Этапов всего"), now("Этапов готово", "0")], hint: NUMBERS_HINT,
        title: ({ subject }) => subject ? `Запустить ${quoted(subject)}` : "Запустить новый проект" },
      { key: "finish", label: "Закончить начатый", description: "довести до конца то, что уже идёт", direction: "increase", unit: custom("этапов"),
        subject: named("Название проекта", "Например, сайт-портфолио"), numbers: [goal("Этапов всего"), now("Этапов готово", "0")], hint: NUMBERS_HINT,
        title: ({ subject }) => subject ? `Закончить ${quoted(subject)}` : "Закончить начатый проект" },
      { key: "regular", label: "Вести регулярно", description: "считаем публикации в месяц", direction: "increase", unit: custom("публикаций в месяц"),
        subject: named("Название проекта", "Например, блог"), numbers: [goal("Публикаций в месяц"), now("Сейчас в месяц", "0")], hint: NUMBERS_HINT,
        title: ({ subject }) => subject ? `Вести ${quoted(subject)} регулярно` : "Вести проект регулярно" },
      own("напишите цель своими словами"),
    ],
  },
  skills: {
    domainKey: "skills", summary: "хобби и навыки с измеримым ростом", question: "Какой навык хотите прокачать?",
    lead: "Выберите один вариант или напишите свой.", limit: ONBOARDING_CHOICE_LIMITS.skills, layout: "cards",
    ownUnits: [{ unit: "custom", unit_label: "часов практики" }, { unit: "custom", unit_label: "рейтинг" }, { unit: "custom", unit_label: "работ" }, { unit: "minutes", unit_label: null }], note: null,
    options: [
      { key: "chess", label: "Шахматы", description: "считаем рейтинг", direction: "increase", unit: custom("рейтинг"), subject: null,
        numbers: [now("Рейтинг сейчас"), goal("Хочу рейтинг")], hint: NUMBERS_HINT,
        title: ({ target }) => { const rating = titleNumber(target); return rating ? `Шахматы: рейтинг ${rating}` : "Шахматы"; } },
      { key: "programming", label: "Программирование", description: "считаем часы практики", direction: "increase", unit: custom("часов практики"), subject: null,
        numbers: [now("Сейчас", "0"), goal()], hint: NUMBERS_HINT,
        title: ({ target }) => { const hours = counted(target, HOURS); return hours ? `Программирование: ${hours} практики` : "Программирование"; } },
      { key: "instrument", label: "Музыкальный инструмент", description: "считаем часы практики", direction: "increase", unit: custom("часов практики"), subject: null,
        numbers: [now("Сейчас", "0"), goal()], hint: NUMBERS_HINT,
        title: ({ target }) => { const hours = counted(target, HOURS); return hours ? `Музыкальный инструмент: ${hours} практики` : "Музыкальный инструмент"; } },
      { key: "drawing", label: "Рисование", description: "считаем готовые работы", direction: "increase", unit: custom("работ"), subject: null,
        numbers: [now("Сейчас", "0"), goal()], hint: NUMBERS_HINT,
        title: ({ target }) => { const works = counted(target, { one: "работа", few: "работы", many: "работ", other: "работы" }); return works ? `Рисование: ${works}` : "Рисование"; } },
      own("напишите цель своими словами"),
    ],
  },
  health: {
    domainKey: "health", summary: "тренировки, вес, сон, шаги", question: "Что для вас главное в здоровье сейчас?",
    lead: "Можно выбрать до трёх. Каждый выбор станет отдельной целью.", limit: ONBOARDING_CHOICE_LIMITS.health, layout: "tiles",
    ownUnits: [{ unit: "custom", unit_label: "км" }, { unit: "custom", unit_label: "тренировок в неделю" }, { unit: "custom", unit_label: "кг" },
      { unit: "custom", unit_label: "часов сна" }, { unit: "custom", unit_label: "шагов в день" }],
    note: "Свой ответ сохраняется как есть, вашими словами. Не уверены в цифрах? Оставьте примерные: пока у цели нет измерений, их можно поправить.",
    options: [
      { key: "training", label: "Регулярные тренировки", description: null, direction: "increase", unit: custom("тренировок в неделю"), subject: null,
        numbers: [now("Сейчас", "0"), goal()], hint: NUMBERS_HINT,
        title: ({ target }) => { const times = counted(target, TIMES); return times ? `Тренировки ${times} в неделю` : "Регулярные тренировки"; } },
      { key: "weight", label: "Снизить вес", description: null, direction: "decrease", unit: custom("кг"), subject: null,
        numbers: [now(), goal()], hint: NUMBERS_HINT,
        title: ({ target }) => { const weight = titleNumber(target); return weight ? `Вес до ${weight} кг` : "Снизить вес"; } },
      { key: "sleep", label: "Больше спать", description: null, direction: "increase", unit: custom("часов сна"), subject: null,
        numbers: [now(), goal()], hint: NUMBERS_HINT,
        title: ({ target }) => { const hours = counted(target, HOURS); return hours ? `Спать ${hours}` : "Больше спать"; } },
      { key: "walk", label: "Больше ходить пешком", description: null, direction: "increase", unit: custom("шагов в день"), subject: null,
        numbers: [now(), goal()], hint: NUMBERS_HINT,
        title: ({ target }) => { const steps = counted(target, { one: "шаг", few: "шага", many: "шагов", other: "шага" }); return steps ? `Ходить ${steps} в день` : "Больше ходить пешком"; } },
      { key: "sweets", label: "Меньше сладкого", description: null, direction: "decrease", unit: custom("раз в неделю"), subject: null,
        numbers: [now(), goal()], hint: NUMBERS_HINT, title: () => "Меньше сладкого" },
      own("напишите цель своими словами"),
    ],
  },
});

/** Rhythm step: the stored value, its label and a short explanation. */
export const CHECKIN_RHYTHM_OPTIONS: readonly { key: CheckinRhythm; label: string; description: string }[] = Object.freeze([
  { key: "daily", label: "Каждый день", description: "короткая отметка в конце дня" },
  { key: "few_per_week", label: "2–3 раза в неделю", description: "в удобные дни" },
  { key: "weekly", label: "Раз в неделю", description: "итоги недели" },
  { key: "self", label: "Сам, без напоминаний", description: "отмечаю, когда захочу" },
]);

/** A field of the step where the person can fix the reason a proposed goal is not valid yet. */
export type OnboardingIssueField = "subject" | "direction" | "unit" | "unit_label" | "baseline" | "target" | "due_at";
/**
 * A goal built from the answers. `input` passes the public creation contract (and is what «Создать N целей» creates)
 * or is null with the fields to fix. `draft` is what the preview and the summary show either way.
 */
export type OnboardingProposal = {
  key: string;
  domainKey: DomainKey;
  /** From a template, from «Свой вариант» (or «Другой» language) or added on the summary. */
  source: "answer" | "own" | "extra";
  option: string | null;
  draft: Pick<CreateGoalInput, "title" | "direction" | "unit" | "unit_label" | "baseline" | "target" | "due_at">;
  input: CreateGoalInput | null;
  issues: readonly OnboardingIssueField[];
};

/** «3 000», «21,1» → «3000», «21.1». Spaces of a thousands separator are dropped; the rest is checked by the contract. */
export function onboardingDecimal(value: string): string {
  return value.replace(/[\s  ]/g, "").replace(",", ".");
}

export function findOnboardingOption(domainKey: DomainKey, option: string): OnboardingOption | null {
  return ONBOARDING_QUESTIONS[domainKey].options.find((candidate) => candidate.key === option) ?? null;
}

function unitOf(spec: OnboardingUnitSpec, choice: OnboardingChoice): Pick<CreateGoalInput, "unit" | "unit_label"> {
  if (spec.kind === "fixed") return { unit: spec.unit, unit_label: spec.unit_label };
  if (spec.kind === "level") return { unit: "custom", unit_label: LANGUAGE_LEVEL_UNIT_LABEL };
  if (spec.kind === "currency") return { unit: choice.unit, unit_label: null };
  return { unit: choice.unit, unit_label: choice.unit === "custom" ? choice.unit_label.trim() : null };
}

const ISSUE_PATHS: Readonly<Record<string, OnboardingIssueField>> = { title: "subject", direction: "direction", unit: "unit", unit_label: "unit_label", baseline: "baseline", target: "target", due_at: "due_at" };

function proposalOf(domainKey: DomainKey, choice: OnboardingChoice): OnboardingProposal | null {
  const option = findOnboardingOption(domainKey, choice.option);
  if (!option) return null;
  const issues = new Set<OnboardingIssueField>();
  const subject = choice.subject.trim();
  if (option.subject && ((option.subject.required && subject.length === 0) || subject.length > option.subject.maxLength)) issues.add("subject");
  const baseline = onboardingDecimal(choice.baseline);
  const target = onboardingDecimal(choice.target);
  const unit = unitOf(option.unit, choice);
  if (option.unit.kind === "currency" && unit.unit !== "NOK" && unit.unit !== "USD") issues.add("unit");
  if (option.unit.kind === "own" && unit.unit === "custom" && (unit.unit_label ?? "").length > GOAL_UNIT_LABEL_MAX_LENGTH) issues.add("unit_label");
  if (option.unit.kind === "level") {
    // Levels are A1…C2 only: whole numbers 1…6.
    if (!/^[1-6]$/.test(baseline)) issues.add("baseline");
    if (!/^[1-6]$/.test(target)) issues.add("target");
  }
  const draft = {
    title: option.title({ subject, target: target.length ? target : null }).trim(),
    direction: option.direction === "own" ? choice.direction : option.direction,
    ...unit, baseline, target, due_at: choice.due_at,
  };
  const parsed = createGoalInputSchema.safeParse({ domain_key: domainKey, ...draft });
  if (!parsed.success) for (const issue of parsed.error.issues) issues.add(ISSUE_PATHS[String(issue.path[0])] ?? "target");
  const source = option.unit.kind === "own" || option.key === "other" ? "own" : "answer";
  return { key: `${domainKey}.${option.key}`, domainKey, source, option: option.key, draft,
    input: parsed.success && issues.size === 0 ? parsed.data : null, issues: [...issues] };
}

/**
 * Goals proposed by the answers (`buildOnboardingGoals`): one per answered option of each chosen sphere in registry order,
 * then the goals added on the summary. Skipped questions and spheres that were not chosen give none. Nothing is stored here.
 */
export function buildOnboardingGoals(answers: OnboardingAnswers): OnboardingProposal[] {
  const proposals: OnboardingProposal[] = [];
  for (const domainKey of DOMAIN_KEYS) {
    const sphere = answers.spheres[domainKey];
    if (!answers.domains.includes(domainKey) || !sphere || sphere.skipped) continue;
    const allowed: readonly string[] = ONBOARDING_OPTIONS[domainKey];
    for (const choice of sphere.choices.slice(0, ONBOARDING_CHOICE_LIMITS[domainKey])) {
      if (!allowed.includes(choice.option)) continue;
      const proposal = proposalOf(domainKey, choice);
      if (proposal) proposals.push(proposal);
    }
  }
  answers.extra.forEach((input, index) => {
    proposals.push({ key: `extra.${index}`, domainKey: input.domain_key, source: "extra", option: null,
      draft: { title: input.title, direction: input.direction, unit: input.unit, unit_label: input.unit_label, baseline: input.baseline, target: input.target, due_at: input.due_at },
      input, issues: [] });
  });
  return proposals;
}

/** Proposals ticked on the summary: valid ones the person did not untick. */
export function selectedOnboardingGoals(answers: OnboardingAnswers, proposals = buildOnboardingGoals(answers)): OnboardingProposal[] {
  return proposals.filter((proposal) => proposal.input !== null && !answers.unchecked.includes(proposal.key));
}

/** An empty draft for the first visit (and a draft of another catalog version). */
export function emptyOnboardingAnswers(): OnboardingAnswers {
  return { step: "domains", domains: [], spheres: {}, rhythm: null, timezone: null, extra: [], unchecked: [] };
}

/** A fresh choice of an option: the template's prefilled numbers, NOK for money, «Увеличить» for an own goal. */
export function newOnboardingChoice(domainKey: DomainKey, optionKey: string): OnboardingChoice {
  const option = findOnboardingOption(domainKey, optionKey);
  const initial = (field: "baseline" | "target") => option?.numbers.find((number) => number.field === field)?.initial ?? "";
  return { option: optionKey, subject: "", direction: option && option.direction !== "own" ? option.direction : "increase",
    unit: option?.unit.kind === "fixed" ? option.unit.unit : option?.unit.kind === "level" ? "custom" : option?.unit.kind === "own" ? "custom" : "NOK",
    unit_label: "", baseline: initial("baseline"), target: initial("target"), due_at: null };
}
