# LifeOS — Master Implementation Plan v0.4

> **Статус:** Planning / ready for technical decomposition  
> **Дата:** 2026-11-06  
> **Основа:** `LifeOS — PRD v0.3` (Claude) + решения по React/Next.js и первоначальное видение LifeOS  
> **Главная цель:** создать полноценную персональную платформу отслеживания развития в разных сферах жизни; **изучение языков — первый завершённый модуль, а не вся платформа**.  
> **Стратегия:** personal-first, SaaS-ready; один пользователь для пилота, изоляция данных по пользователям с первого дня.  
> **План до проверенного MVP:** **8 этапов**, сгруппированных в 3 последовательных релиза.

---

## 0. Краткое резюме решений

### Принято из PRD v0.3 Claude

- **Единый TypeScript-стек:** Next.js (App Router), React, Node.js, TypeScript strict.
- **Монорепозиторий:** pnpm workspaces + Turborepo.
- **Одно приложение Next.js:** основная Web-платформа, Telegram Mini App и HTTP API в `apps/web`; отдельный процесс `apps/worker`.
- **Данные:** PostgreSQL + Drizzle ORM; фоновая обработка — pg-boss в той же PostgreSQL.
- **Авторизация:** Better Auth, Telegram deep-link, серверная проверка Telegram Mini App `initData`.
- **Telegram-бот:** grammY; HTTPS webhook на сервере, отдельный dev-бот для разработки.
- **AI:** AI SDK (Vercel) под тонким внутренним слоем, единый runtime, два логических агента — Tutor и Platform Assistant; белый список разрешённых tools.
- **Карточки:** `ts-fsrs` через собственный интерфейс планировщика, без реализации алгоритма с нуля.
- **Валидация/UI/тесты:** Zod, Tailwind CSS, shadcn/ui, Vitest, Playwright.
- **Прогресс:** реальные записи и SQL-запросы, без преждевременной системы проекций и материализованных снимков.

### Уточнения v0.4 по сравнению с Claude v0.3

1. **LifeOS остаётся мультидоменной платформой:** с MVP доступны базовые карточки сфер жизни и **универсальные цели с ручными измерениями**. Профильный модуль Languages автоматизирует часть показателей; финансы, проекты, работа, навыки и здоровье позже получат свои интеграции и интерфейсы.
2. **MVP разбит на 3 релиза**, чтобы ранняя полезная версия появилась до реализации всего PRD.
3. **P0 пересмотрен:** голосовые сообщения, задания по фильмам и Platform Assistant вводятся в последующих этапах MVP, а не блокируют первый полезный релиз.
4. **Три разных показателя:** прогресс к цели, оценка компетенции, регулярность. Дополнительно указывается **источник/достоверность**: измерено системой, оценено тестом, самоотчёт, предположение AI.
5. **Восемь последовательных этапов** с идентификаторами задач, результатом, тестами и `Definition of Done`.
6. **Версии библиотек фиксируются в начале работ**, а не копируются из чужого PRD. Проверить Node.js-совместимость: актуальная ветка `ts-fsrs` v6 в документации требует Node.js >=24.
7. **Роутинг уточнён:** папка `(telegram)` — только организационная route group; URL Mini App должен иметь явный сегмент `/telegram/*`.
8. **Разделение ответственности:** UI и Route Handlers не содержат бизнес-логику, доменные сервисы не зависят от Next.js, AI не пишет напрямую в SQL.

### Чего не будет до MVP

- Реальных банковских подключений и автоматического расчёта долгов/бюджетов.
- Полноценного Kanban для работы и проектов.
- Медицинских интеграций и оценки состояния здоровья.
- Платежей, тарифов, рабочих пространств команд и сложной multitenancy.
- Реального двустороннего голосового звонка в AI, сертификации CEFR, полноценной оценки произношения.
- Микросервисов по одной службе на домен, event sourcing, преждевременной универсальной low-code системы модулей.

---

## 1. Продукт: что именно мы строим

### 1.1. Видение

**LifeOS — персональная операционная система развития.** Она помогает ответить:

1. Где я сейчас нахожусь в важной для меня сфере?
2. К какой конкретной цели и к какому сроку я двигаюсь?
3. Что мне делать следующим шагом?
4. Что я реально сделал, каков результат и насколько достоверны данные?

Пользователь может фиксировать действия **через интерфейс**, **через центрального AI Assistant** или **через интеграции**. Система хранит факты независимо от истории AI-чата.

### 1.2. Модули LifeOS

| Сфера (`domain_key`) | Целевой функционал | Состояние на MVP |
|---|---|---|
| `languages` | AI-уроки, разговорная практика, слова, тесты, карточки, уровни | **Первый полностью работающий модуль** |
| `finance` | Счета, доходы, расходы, долги, бюджет, цели, Open Banking | Карточка сферы + ручные цели и прогресс |
| `work` | Рабочие задачи, развитие карьеры, профессиональные цели | Карточка + ручные цели |
| `projects` | Проекты, Kanban, этапы, AI-планирование | Карточка + ручные цели |
| `skills` | Любой навык: шахматы, электрика, кодинг и др. | Карточка + ручные цели |
| `health` | Тренировки, привычки, сон и активность | Карточка + ручные цели |

**Важно:** не показывать фиктивный «уровень жизни 74%», если нет проверяемой методики. Для пустых сфер использовать состояния «Нет целей», «Добавить цель», «Автотрекинг появится позже». Скрытие будущих функций допустимо; имитация данных — нет.

### 1.3. Принцип расширяемости

Каждый профильный модуль в будущем добавляет:

- собственные таблицы и доменные сервисы;
- свой набор UI-экранов;
- адаптер измерения целей / метрик;
- инструменты, разрешённые специализированному AI-режиму;
- коннекторы/импорт внешних данных;
- настройки приватности и политики разрешений.

При этом он **повторно использует** `users`, `goals`, `goal_measurements`, `activity_events`, AI Runtime, журнал действий, авторизацию и Dashboard.

### 1.4. Целевые пользовательские сценарии

**Сценарий A — общая цель:** пользователь создаёт «Накопить 50 000 NOK», указывает начальную сумму и текущий баланс вручную; LifeOS показывает прогресс и источник «внесено вручную». Автоматическое подключение банка — позже.

**Сценарий B — язык:** пользователь выбирает Norwegian A2 → B1, подключает Telegram, общается с Tutor, изучает новые слова в Mini App, видит реальные результаты занятий на Dashboard.

**Сценарий C — центральный ассистент:** «Сколько я занимался за неделю?» → Platform Assistant получает точные данные из tools и отвечает. «Измени цель до 20 занятий» → предлагает изменение и выполняет после подтверждения.

**Сценарий D — будущие модули:** «Сегодня был в зале 50 минут» или «Добавь задачу в проект» → те же AI-права, цель и журнал событий применяются в новых специализированных модулях, когда они реализованы.

---

## 2. Границы релизов

| Релиз | Этапы | Что пользователь получает | Что ещё не готово |
|---|---|---|---|
| **MVP 0.1: Foundation + Tutor** | **1–4** | LifeOS Dashboard, общие ручные цели, аккаунт, связанный Telegram, текстовый AI Tutor, языковой профиль, словарь | Mini App, FSRS, формальные уроки, главный AI Assistant |
| **MVP 0.2: Learning Loop** | **5–6** | Telegram Mini App с карточками/FSRS, структурированные уроки, честная языковая статистика и автоматические цели | Central Platform Assistant, голос, задания вне платформы |
| **MVP 0.3: LifeOS Pilot** | **7–8** | Central Platform Assistant с безопасными действиями, голосовые Telegram-сообщения, задания на фильмы, privacy/QA, стабильный личный пилот | Полноценные Finance/Projects/Health, биллинг и публичный SaaS |

**Финальное определение MVP:** к завершению этапа 8 есть работающее кросс-доменное ядро LifeOS, полноценный языковой модуль, центральный AI-помощник и надёжный Telegram-канал. Это не означает, что все шесть сфер уже имеют специализированную автоматизацию.

**Правило приоритета:** если сроки/сложность растут, не расширяем P0; завершаем текущий вертикальный пользовательский сценарий и переносим необязательные функции в следующий релиз.

---

## 3. Архитектура системы

```text
                           ┌────────────────────────────┐
                           │           LifeOS           │
                           │   Next.js / React / TS      │
                           │                            │
                           │ Web UI + Telegram Mini App  │
                           │ API + Telegram Webhook      │
                           └─────────────┬──────────────┘
                                         │
                              auth + validation
                                         │
                           ┌─────────────▼──────────────┐
                           │     Domain Application     │
                           │   (TS, no Next.js deps)    │
                           ├────────────────────────────┤
                           │ Core: goals, events        │
                           │ Language: tutor, lessons  │
                           │ Vocabulary + FSRS         │
                           │ Progress / reporting      │
                           │ AI Runtime + agent tools  │
                           └──────┬───────────┬─────────┘
                                  │           │
                      ┌───────────▼─┐   ┌─────▼──────────┐
                      │ PostgreSQL  │   │ Node.js worker │
                      │ + Drizzle   │◄─►│ + pg-boss      │
                      │ + pg-boss   │   │ jobs / retries │
                      └─────────────┘   └─────┬──────────┘
                                               │
                                  ┌────────────▼───────────┐
                                  │ LLM / STT / Telegram   │
                                  │ External integrations  │
                                  └────────────────────────┘
```

### 3.1. Стек

| Слой | Выбор |
|---|---|
| Web/API/Mini App | Next.js App Router + React + TypeScript strict |
| Runtime | поддерживаемая Node.js LTS, совместимая со всеми закреплёнными версиями; проверить требование `ts-fsrs` v6 (Node >=24) |
| Стили/UI | Tailwind CSS + shadcn/ui |
| Auth | Better Auth + Drizzle adapter |
| База | PostgreSQL + Drizzle ORM / Drizzle Kit |
| Queue / cron | pg-boss + отдельный TypeScript worker |
| Telegram Bot | grammY, webhook в prod, polling у отдельного dev-бота |
| Mini App | Telegram Mini Apps SDK для React + серверный валидатор `initData` |
| AI | AI SDK под внутренней обёрткой/registry |
| Карточки | `ts-fsrs` через `ReviewScheduler` |
| Контракты | Zod + общий `contracts`-пакет |
| Тесты | Vitest, тесты с настоящим PostgreSQL, Playwright, AI evals |
| Deploy | Docker Compose на VPS в ЕС: `web`, `worker`, `postgres`, HTTPS reverse proxy |
| Monorepo | pnpm workspaces + Turborepo |

**Версии/совместимость:** на этапе 1 сверить официальные документации, выбрать версии, записать в ADR и зафиксировать `pnpm-lock.yaml`. Не считать любое число версии из PRD v0.3 автоматически подходящим для нового окружения.

### 3.2. Монорепозиторий

```text
lifeos/
├── apps/
│   ├── web/
│   │   ├── app/
│   │   │   ├── (web)/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── goals/
│   │   │   │   ├── languages/
│   │   │   │   ├── assistant/
│   │   │   │   └── settings/
│   │   │   ├── (telegram)/
│   │   │   │   └── telegram/
│   │   │   │       ├── page.tsx
│   │   │   │       ├── review/
│   │   │   │       └── vocabulary/
│   │   │   ├── api/auth/[...all]/
│   │   │   ├── api/v1/
│   │   │   └── api/webhooks/telegram/
│   │   ├── components/
│   │   └── lib/
│   └── worker/
│       ├── src/jobs/
│       └── src/index.ts
├── packages/
│   ├── db/             # schema, migrations, repositories
│   ├── domain/         # core, language, progress, ai, telegram
│   ├── contracts/      # Zod schemas, DTO, error codes
│   └── config/         # lint, tsconfig, env validation
├── docs/
│   ├── adr/
│   ├── api/
│   ├── architecture/
│   ├── help/
│   └── tasks/
├── infra/
│   └── docker/
└── pnpm-workspace.yaml
```

**Маршруты:** `(web)` / `(telegram)` — названия route groups, в публичный URL не входят. Поэтому Mini App использует **явный** `/telegram`, `/telegram/review`, `/telegram/vocabulary`. Маршруты разных групп не должны конфликтовать.

### 3.3. Слои и правила

1. **HTTP / Telegram adapters:** получение события, auth, rate limit, Zod validation, вызов application-service, формирование ответа.
2. **Domain services:** бизнес-правила, ownership, транзакции, изменение записей, события.
3. **Repositories:** Drizzle и выборки по `user_id`, необходимые уникальные индексы.
4. **Workers:** обработка поставленных задач; retry-safe обработчики, дедупликация, учёт ошибок.
5. **AI Runtime:** выбор агента, контекста, модели и tools; **нет** произвольного SQL/сетевого доступа от модели.

Нельзя импортировать Next.js в `packages/domain` или использовать AI-ответ как единственный источник прогресса.

---

## 4. Модель данных — целевая схема MVP

Таблицы вводятся **поэтапно**, а не все одновременно. Поля ниже — архитектурный контракт для проектирования миграций, не готовые миграции.

### 4.1. Identity и LifeOS Core

| Таблица | Ключевые поля / назначение | Этап |
|---|---|---|
| `user`, `session`, `account`, `verification` | Генерируемая схема Better Auth, дополнения `timezone`, `locale` | 2 |
| `external_identities` | `user_id`, `provider`, `provider_user_id`, `linked_at`; UNIQUE provider+provider_user_id | 3 |
| `telegram_link_tokens` | `user_id`, `token_hash`, `expires_at`, `used_at` | 3 |
| `telegram_chat_state` | `user_id`, `telegram_chat_id`, `active_profile_id`, `active_agent` | 3–4 |
| `telegram_updates` | `update_id` UNIQUE, status, processed_at; idempotent webhook | 3 |
| `goals` | `user_id`, `domain_key`, `title`, `metric_key?`, `calculation_mode`, `unit`, `baseline`, `target`, `direction`, `status`, `due_at?` | 2 |
| `goal_measurements` | **Дополнение v0.4:** `goal_id`, `user_id`, `value`, `measured_at`, `source`, `idempotency_key`; ручные замеры без фиктивной статистики | 2 |
| `activity_events` | `user_id`, `domain_key`, `event_type`, `target_type`, `target_id`, `source`, `idempotency_key`, `schema_version`, `occurred_at`, payload | 2 |
| `notification_preferences` | опционально: channel, enabled, quiet hours | 8 |

**Нюансы целей:**

- `domain_key` — enum/registry в коде, не универсальная таблица категорий на MVP.
- `calculation_mode = manual | computed`; для `manual` берём последнее подтверждённое измерение, для `computed` — доменный metric provider.
- Для возрастающего показателя: `(current - baseline) / (target - baseline)`; для убывающего (например, долг) — `(baseline - current) / (baseline - target)`; обработать нулевой знаменатель и границы. Значение ограничивать 0–100% для UI, но фактический `current` хранить без потерь.
- Если цель не имеет базового измерения, выводить «Недостаточно данных», а не `0%` как якобы рассчитанный факт.
- Изменение и удаление измерений — через операции с журналом событий; отчёт/процент всегда пересчитывается из данных.

### 4.2. Language Learning

| Таблица | Основные поля | Этап |
|---|---|---|
| `language_profiles` | user_id, target_language, native_language, preferred_explanation_language, level_estimate, target_level, settings | 4 |
| `conversations` | user_id, agent (`tutor`/`platform`), profile_id?, channel, summary | 3–4 |
| `messages` | conversation_id, role, content, input_type, ai_run_id?, created_at | 3–4 |
| `practice_sessions` | profile_id, conversation_id, active_seconds, started_at, ended_at, message_count | 4–6 |
| `practice_corrections` | practice_session_id, message_id, original, corrected, error_type, explanation | 4–6 |
| `vocabulary_entries` | profile_id, term, normalized_term, sense_key, translation, example, provenance, deleted_at | 4 |
| `review_states` | vocabulary_entry_id, FSRS serialized state, scheduler_version, due_at | 5 |
| `review_attempts` | card_id, rating, state_before, state_after, idempotency_key, reviewed_at | 5 |
| `lesson_sessions` | profile_id, conversation_id, status, objective, started_at, completed_at, active_seconds | 6 |
| `lesson_exercises` | lesson_id, exercise_type, prompt, rubric, answer_key?, sequence | 6 |
| `exercise_attempts` | exercise_id, answer, grader, model?, prompt_version, score, override_score?, errors, idempotency_key | 6 |
| `language_assessments` | profile_id, source, skills_json, estimate, confidence, assessed_at | 6–8 |
| `learner_notes` | profile_id, kind, note, provenance, deleted_at | 4 / 8 |
| `assignments` | profile_id, type, instructions, due_at, status, provenance | 8 |

**Данные для статистики:** история сообщений не заменяет уроки, практику и повторения карточек. `activity_events` — аудит и удобный журнал действий, **не** единственный источник истины.

### 4.3. AI

| Таблица | Назначение | Этап |
|---|---|---|
| `ai_runs` | агент, модель, provider, prompt_version, status, token_usage, cost, latency, correlation_id | 3 |
| `ai_tool_calls` | tool_name, validated_args, status, confirmation_status, result_ref | 3 / 7 |
| `agent_action_confirmations` (если потребуется отдельно) | pending/confirmed/rejected/expired, actor_id, TTL, idempotency | 7 |

**Ограничение роста схемы:** таблицу подтверждений можно не создавать отдельно, если `ai_tool_calls` уже покрывает lifecycle подтверждения. Принять выбор через ADR перед реализацией этапа 7.

### 4.4. Индексы и инварианты

- Каждая доменная запись привязана к владельцу через `user_id` или проверяемую связь с владельцем.
- `external_identities(provider, provider_user_id)` UNIQUE.
- `telegram_updates(update_id)` UNIQUE.
- Один активный `lesson_session` на языковой профиль — partial UNIQUE index.
- `review_attempts.idempotency_key`, `exercise_attempts.idempotency_key`, `activity_events.idempotency_key` UNIQUE в согласованном scope.
- Словарь: уникальность `profile_id + normalized_term + sense_key` для неудалённых записей; разрешить разные значения одного слова.
- Индексы по `user_id + created_at/occurred_at`, `language_profile_id`, `due_at`.
- Время в UTC; статистика по дням — в `users.timezone`.
- Задачи в pg-boss + доменные записи помещать **в одной транзакции только после проверки совместимости драйвера и DB-адаптера**; worker всё равно обязан быть идемпотентным.

---

## 5. Универсальный Progress Model

### 5.1. Четыре разных свойства, которые нельзя смешивать

1. **Goal progress:** выполнено 12/20 уроков = 60% от **заданной цели**.
2. **Competence estimate:** например, `A2 (self-reported)` или `B1 (diagnostic estimate)`; не процент освоения всего языка.
3. **Consistency:** 4 дня активности из 5 запланированных; период и методика показаны.
4. **Evidence / provenance:** automatic / assessed / manual / AI-suggested. Это атрибут доказательности, **не произвольная «вероятность 87%»**.

### 5.2. Формат метрики для UI/API

```ts
type MetricResult = {
  key: string;
  label: string;
  current: number | null;
  target?: number;
  unit: 'count' | 'minutes' | 'NOK' | 'percent' | 'custom';
  period?: { from: string; to: string };
  progressPercent?: number | null;
  provenance: 'system' | 'assessment' | 'manual' | 'ai_suggested';
  methodology: string;
  updatedAt: string | null;
};
```

На MVP `MetricResult` вычисляется SQL-сервисами из записей, без `metric_snapshots` и отдельного event sourcing. Существующие сферы могут отображаться в общем Dashboard, даже если для них пока есть только ручные цели.

### 5.3. Языковые показатели MVP

- Число начатых/завершённых уроков.
- Сумма активных минут **уроков** и отдельно **свободной практики**.
- Всего слов, карточек к повторению, повторений за период.
- Условно освоенные слова (явно подписанная FSRS-эвристика, не «знает слово на 100%»).
- Дни активности и выполненная норма.
- Уровень CEFR только с источником оценки и указанием ограничений.
- Ошибки в упражнениях/практике по типам; задания вне платформы отдельно как self-report.

**Минуты:** не использовать разницу между временем первого и последнего сообщения как длительность целиком. Засчитывать только интервалы активности в пределах установленного порога (в PRD v0.3 предложено 10 минут на паузу); правило документировать и тестировать.

---

## 6. AI Architecture

### 6.1. Один runtime, несколько ролей

```text
AI Runtime
├── Model Provider Adapter (AI SDK)
├── Agent Registry
│   ├── LanguageTutor       [MVP]
│   ├── PlatformAssistant   [MVP]
│   ├── FinanceCoach        [later]
│   ├── ProjectAssistant    [later]
│   ├── CareerCoach         [later]
│   └── SkillTutor          [later]
├── Context Builders / Summaries
├── Typed Tool Registry + Permissions
├── Approvals / Confirmations
├── Usage + Cost Accounting / Budgets
└── Evals / Prompt Versions
```

Логически два агента на MVP; инфраструктурно это общий runtime, сервисы, хранилище и worker. У каждого агента — свой промпт, модели, контекст, tools и диалог.

### 6.2. Tutor

**Обязанности:** обучение выбранному языку, свободная практика, до трёх важных исправлений по умолчанию, вопросы, рекомендации по темам и слова к сохранению, структурированные уроки, домашние задания (позже).

**Инструменты:** `get_learner_context`, `suggest_vocabulary`, `create_vocabulary_entries` после подтверждения, `start_lesson`, `submit_exercise_answer`, `complete_lesson`, `get_due_cards`, `suggest_topics`, `handoff_to_platform`.

**Ограничения:** не может менять финансовые цели, настройки аккаунта, email, Telegram-привязку или получать произвольные чужие записи.

### 6.3. Platform Assistant

**Обязанности:** общий обзор LifeOS, объяснение показателей, управление разрешёнными целями и настройками через подтверждение, маршрутизация к Tutor.

**Инструменты:** `get_dashboard`, `list_goals`, `get_goal`, `create_goal`, `propose_goal_measurement`, `get_learning_progress`, `list_lessons`, `search_vocabulary`, `handoff_to_tutor`, `search_help`.

**Ограничения:** не имеет права самостоятельно придумывать цифры прогресса, выставлять CEFR или проводить языковую оценку; не может удалять аккаунт, обходить подтверждение или исполнять SQL.

### 6.4. Обязательный pipeline

1. Идентифицировать пользователя/канал/агента и профиль.
2. Загрузить минимально необходимый контекст (а не всю историю без лимита).
3. Проверить лимиты AI и разрешённые модели.
4. Вызвать LLM через AI SDK с ограничением числа шагов.
5. Валидировать каждый вызов инструмента Zod и серверными проверками ownership/permissions.
6. Для мутаций, требующих подтверждения: сформировать preview → `pending` → явный `confirm` → атомарная доменная операция.
7. Записать `ai_runs`, `ai_tool_calls`, события, ошибки и стоимость.
8. Отправить ответ в Web (streaming) или Telegram (через worker, после быстрого ACK webhook).

**Бюджет:** дневной/месячный лимит и лимит на агент; учесть конкурентные запросы и оценку стоимости ещё до вызова, а также фактический usage после. Для строгого ограничения — атомарное резервирование квоты; дополнительно бюджет у провайдера.

**Качество:** версионированные промпты; эталонные кейсы на корректность языка, допустимые ответы, ошибки, tool permissions и отсутствие вымышленных чисел. Изменение модели или промпта не принимается без проверки.

---

# 7. План реализации: 8 этапов до MVP

> Ниже чек-листы предназначены как **основа для декомпозиции в независимые задачи Codex**. Одна галочка — один проверяемый результат; сложные пункты разбиваются на отдельные issue/PR. Переход к следующему этапу — только после выполнения `Definition of Done` предыдущего.

## ЭТАП 1 — Foundation и технические контракты

**Цель:** воспроизводимое окружение и архитектура, которая не потребует полного переписывания при добавлении модулей.

**Зависимости:** нет.

### Задачи

- [ ] **LFS-101** — создать репозиторий с pnpm + Turborepo и `apps/web`, `apps/worker`, `packages/db`, `packages/domain`, `packages/contracts`, `packages/config`.
- [ ] **LFS-102** — выбрать совместимые версии Node.js/Next.js/Better Auth/Drizzle/pg-boss/AI SDK/ts-fsrs; закрепить в lockfile и `docs/adr/001-stack.md`.
- [ ] **LFS-103** — Next.js App Router, React strict TS, Tailwind, shadcn/ui, базовая дизайн-система и layout.
- [ ] **LFS-104** — PostgreSQL в Docker, подключение Drizzle и система миграций.
- [ ] **LFS-105** — pg-boss + worker: demo-job, обработка ошибок, retries, отдельный запуск процесса.
- [ ] **LFS-106** — общие Zod-контракты, формат `data/meta/errors`, error codes, request/correlation ID, env validation.
- [ ] **LFS-107** — тест совместной транзакции через временную test-fixture таблицу + постановка job, проверка idempotency; рабочую `activity_events` вводим на этапе 2 после схемы `user`.
- [ ] **LFS-108** — CI: lint, typecheck, unit tests, интеграционный тест на реальном PostgreSQL, build.
- [ ] **LFS-109** — `docs/architecture/`, ADR-шаблон, правила разработки с Codex, инструкции запуска.

**Definition of Done:** один набор команд поднимает проект локально; Next.js отвечает, миграции работают, worker выполняет тестовую задачу, CI проходит без ошибок, репозиторий документирован.

**Результат для пользователя:** техническая основа, пока без функциональной ценности.

---

## ЭТАП 2 — LifeOS Core, аккаунт и общий Dashboard

**Цель:** с первого работающего интерфейса показать, что LifeOS — система управления жизнью, а не отдельный чат с учителем.

**Зависимости:** этап 1.

### Задачи

- [ ] **LFS-201** — Better Auth: email/password, login/logout, восстановление, закрытая регистрация по allowlist.
- [ ] **LFS-202** — `user` timezone/locale, ownership-политики для всех core repositories; негативные тесты доступа.
- [ ] **LFS-203** — программный реестр сфер `languages`, `finance`, `work`, `projects`, `skills`, `health`: название, иконка, статус, URL; без таблицы `domains`.
- [ ] **LFS-204** — Web Dashboard: обзор сфер, цели на сегодня, последние факты, состояния без данных (no fake scores).
- [ ] **LFS-205** — таблица `goals`: название, сфера, единица, baseline, target, срок, тип расчёта, направление изменения.
- [ ] **LFS-206** — таблица `goal_measurements` + ручное добавление, редактирование и удаление замеров с аудитом.
- [ ] **LFS-207** — API целей и измерений + вычисление процентов с защитой от некорректных знаменателей и отсутствующих данных.
- [ ] **LFS-208** — UI создания общей цели в любой сфере; пример: цель по финансам в NOK, без банковского подключения.
- [ ] **LFS-209** — тест: пользователь видит только свои цели; новые измерения правильно изменяют цифры Dashboard.
- [ ] **LFS-210** — создать `activity_events` с FK на владельца и аудитом изменений целей/измерений в общей транзакции.

**Definition of Done:** пользователь входит, создаёт цель в любой сфере, фиксирует значение, видит корректный прогресс и его источник; на пустых карточках нет выдуманных процентов.

**Результат:** первый рабочий кросс-доменный LifeOS Core, пусть пока с ручным вводом.

---

## ЭТАП 3 — Telegram, AI Runtime и инфраструктура агента

**Цель:** безопасно связать Telegram с аккаунтом и получить базовое работающее общение с AI через общий runtime.

**Зависимости:** этапы 1–2.

### Задачи

- [ ] **LFS-301** — зарегистрировать отдельные Telegram bots для разработки и production; конфигурация grammY.
- [ ] **LFS-302** — `external_identities`, одноразовые привязки через `/start <token>`, хранение хэша, TTL и защита от повторного связывания.
- [ ] **LFS-303** — webhook secret, дедупликация `update_id`, запись job в pg-boss, немедленный ACK.
- [ ] **LFS-304** — worker получает update, определяет владельца, отправляет ответ через Telegram API; безопасные retries.
- [ ] **LFS-305** — AI SDK provider wrapper, agent registry, prompt versioning, модели через серверные конфиги.
- [ ] **LFS-306** — `conversations`, `messages`, `ai_runs`, `ai_tool_calls`; correlation ID и запись токенов/расходов.
- [ ] **LFS-307** — typed tool registry, Zod validation, access policies, жёсткий запрет произвольного SQL/HTTP/tool у LLM.
- [ ] **LFS-308** — базовые лимиты частоты, длины сообщения, размера контекста, бюджета и количества шагов AI.
- [ ] **LFS-309** — первые agent evals: запрещённый tool, неизвестный пользователь, неверная подпись, повтор update, ошибка LLM.

**Definition of Done:** связанный пользователь пишет сообщение Telegram и получает ответ; webhook не висит до завершения LLM, повтор update не создаёт повторную операцию, чужие telegram_id отклоняются.

**Результат:** безопасная инфраструктура для Language Tutor и всех будущих AI-режимов.

---

## ЭТАП 4 — Language Tutor: языковые профили, практика, словарь

**Цель:** первый действительно полезный пользовательский продукт — AI-учитель в Telegram и Web.

**Зависимости:** этапы 2–3.

### Задачи

- [ ] **LFS-401** — языковые профили: изучаемый и родной язык, язык объяснений, текущая предварительная оценка, целевой уровень, дневная норма, строгость исправлений.
- [ ] **LFS-402** — переключение активного языка в Telegram, независимые диалоги/словари по профилям.
- [ ] **LFS-403** — Language Tutor prompt + context builder: уровень, цель, недавние сообщения, заметки и типичные ошибки.
- [ ] **LFS-404** — свободный текстовый чат в Telegram, уточняющие вопросы и предложение трёх тем (`/topic`).
- [ ] **LFS-405** — structured reply: ответ по теме, до трёх ключевых исправлений по умолчанию, объяснения, следующий вопрос, предложения слов.
- [ ] **LFS-406** — Web чат с тем же Tutor и историей через `/languages/[id]/tutor`.
- [ ] **LFS-407** — `practice_sessions`: сессии текстовой практики и активные минуты без начисления длинных пауз.
- [ ] **LFS-408** — CRUD словаря: вручную, через UI и после предложения Tutor; дедупликация слов/значений.
- [ ] **LFS-409** — первичные показатели: количество слов, практика по дням/минутам, история; корректная маркировка предварительного CEFR.
- [ ] **LFS-410** — тесты: смена языка не смешивает контекст; prompt/schema errors не портят данные; AI предлагает новые слова, но сохраняет только по подтверждению.

**Definition of Done / релиз MVP 0.1:** пользователь связывает Telegram, выбирает язык, переписывается с Tutor, видит исправления, добавляет слова и получает статистику практики в LifeOS; может также создать произвольную ручную цель в другой сфере.

**Не блокирует MVP 0.1:** голос, Mini App, интервальные повторения, структурированные уроки, Platform Assistant, фильмы.

---

## ЭТАП 5 — Telegram Mini App, словарные карточки и FSRS

**Цель:** замкнуть цикл сохранения и интервального повторения слов.

**Зависимости:** этапы 3–4.

### Задачи

- [ ] **LFS-501** — Mini App внутри `apps/web/app/(telegram)/telegram/*`; отдельный layout и мобильная навигация.
- [ ] **LFS-502** — серверная проверка сырого Telegram `initData` (signature + допустимый `auth_date`), обмен на короткую ограниченную сессию; отклонение подделок/replay.
- [ ] **LFS-503** — экраны Today, Review, Vocabulary, Profile; тема Telegram и удобный интерфейс WebView.
- [ ] **LFS-504** — карточка: лицевая сторона, flip, перевод, пример, кнопки Again/Hard/Good/Easy.
- [ ] **LFS-505** — `ReviewScheduler` на `ts-fsrs`, зафиксированная версия/формат сериализации scheduler state.
- [ ] **LFS-506** — `review_states`, `review_attempts` с уникальным ключом запроса и возможностью восстановления истории.
- [ ] **LFS-507** — выбор due-карточек для выбранного языка, повторение, обновление `due_at`, статистика.
- [ ] **LFS-508** — mobile UX: состояние загрузки, повтор при сетевой ошибке, защита от двойного нажатия, работа с короткими экранами.
- [ ] **LFS-509** — тесты: оценка применяется строго один раз; разные пользователи/языки не видят чужие карточки; результаты появляются в Web.

**Definition of Done:** из Telegram открывается Mini App, пользователь повторяет слова, планировщик сохраняет результат и следующую дату; двойной запрос не меняет расписание второй раз.

**Результат:** реальный self-study loop между чат-учителем и карточками.

---

## ЭТАП 6 — Уроки, оценивание, честный Progress Dashboard

**Цель:** формальное обучение с проверяемыми результатами, а не только диалог и карточки.

**Зависимости:** этапы 4–5.

### Задачи

- [ ] **LFS-601** — `lesson_sessions`: planned/active/completed/abandoned, правила завершения и один активный урок на профиль.
- [ ] **LFS-602** — генерация плана из 3–6 заданий через structured output; Zod validation; сохранение рубрики **до** ответа ученика.
- [ ] **LFS-603** — оценка multiple choice / fill blank кодом; translation/free writing — LLM grader с рубрикой и учётом нескольких допустимых решений.
- [ ] **LFS-604** — запись `exercise_attempts` с моделью, версией промпта, критерием, ошибками; оспаривание оценки без удаления оригинала.
- [ ] **LFS-605** — `/lesson`, ответы, `/finish` в Telegram; просмотр урока/ошибок/истории в Web.
- [ ] **LFS-606** — worker закрывает брошенные уроки; незавершённые занятия не увеличивают счётчик завершённых уроков.
- [ ] **LFS-607** — Progress services: уроки, активные минуты, практика, слова, due, регулярность; SQL и timezone пользователя.
- [ ] **LFS-608** — целевые метрики Languages подключены к общим `goals` через calculated metric adapter.
- [ ] **LFS-609** — Dashboard: видны источник данных, методика, numerator/denominator и различие между прогрессом цели, оценкой уровня и регулярностью.
- [ ] **LFS-610** — E2E: урок в Telegram → 2 слова → Mini App review → проверка Dashboard и корректность счётчиков.

**Definition of Done / релиз MVP 0.2:** полноценный учебный цикл работает end-to-end; проценты и статистика вычисляются по фактическим записям; оценки объяснимы и могут быть оспорены.

**Результат:** первый полностью работающий профильный модуль LifeOS — Languages.

---

## ЭТАП 7 — Central Platform Assistant и межмодульные действия

**Цель:** сделать LifeOS именно AI-платформой, а не набором разрозненных интерфейсов.

**Зависимости:** этапы 2–6.

### Задачи

- [ ] **LFS-701** — добавить Platform Assistant в общий agent registry; отдельный prompt, модель, контекст, tools.
- [ ] **LFS-702** — Web `/assistant`; общий обзор целей, активности и языкового прогресса.
- [ ] **LFS-703** — `get_dashboard`, `list_goals`, `get_goal`, `get_learning_progress`, `list_lessons`, `search_vocabulary`.
- [ ] **LFS-704** — безопасные операции с целями и ручными измерениями: preview → confirm → audit; запрет изменений без согласия.
- [ ] **LFS-705** — Telegram команды `/assistant`, `/tutor` и agent handoff в одном боте; выбранный агент виден в интерфейсе.
- [ ] **LFS-706** — разграничение tools и контекста: Tutor не может произвольно менять цели, Platform Assistant не оценивает уроки.
- [ ] **LFS-707** — ответы о метриках только из tool results; тесты на выдуманные числа и prompt injection.
- [ ] **LFS-708** — справка для ассистента `docs/help`, хранение суммарного контекста вместо бесконечного диалога.
- [ ] **LFS-709** — универсальный пример: «Создай финансовую цель 50 000 NOK и добавь замер 12 000 NOK» → подтверждение → обновление Dashboard.

**Definition of Done:** central assistant знает модули LifeOS, достоверно отвечает о фактическом прогрессе, после подтверждения создаёт цель в любой сфере и не может выполнить недопустимую операцию.

**Результат:** первое действительно кросс-доменное использование AI.

---

## ЭТАП 8 — Voice, задания, безопасность, пилотный релиз

**Цель:** довести продукт до стабильного личного MVP с достаточным качеством, приватностью и полезными ежедневными сценариями.

**Зависимости:** этапы 1–7.

### Задачи

- [ ] **LFS-801** — Telegram voice → download → STT → текст Tutor → ответ с показом расшифровки; локальная копия аудио удаляется после обработки (политика хранения у Telegram и STT-провайдера рассматривается отдельно).
- [ ] **LFS-802** — помечать ошибки голосового ввода как менее надёжные; не оценивать произношение по текстовой расшифровке.
- [ ] **LFS-803** — `learner_notes` для интересов/любимых фильмов; пользователь видит и редактирует заметки Tutor.
- [ ] **LFS-804** — задания по просмотру фильмов/серий: частота, статус, дедлайн, обсуждение после выполнения; происхождение `manual`/self-report.
- [ ] **LFS-805** — экспорт личных данных (JSON), удаление аккаунта, управление привязкой Telegram, сроки хранения сообщений, privacy notice.
- [ ] **LFS-806** — тесты авторизации, webhook replay, initData TTL, AI tools ownership, CSRF/session, rate limiting, обработка ошибок LLM и STT.
- [ ] **LFS-807** — оценка качества агентов (evals), лимиты бюджета, расходы по агенту/уроку, мониторинг ошибок и очередей.
- [ ] **LFS-808** — Docker Compose staging/production, HTTPS, backup off-site, проверенное восстановление PostgreSQL.
- [ ] **LFS-809** — Playwright + ручные smoke-тесты Telegram Mini App на телефоне; доступность основных форм и карточек.
- [ ] **LFS-810** — личный пилот: минимум несколько учебных циклов в разные дни, устранение блокирующих проблем, сбор замечаний в backlog.

**Definition of Done / релиз MVP 0.3:** система проходит все критические E2E-сценарии, данные не теряются, пользователь может получить/удалить свои данные, AI работает в рамках разрешений и бюджета, Telegram + Web показывают согласованные результаты.

**Результат:** первая завершённая версия LifeOS для реального ежедневного использования, подготовленная к последующему расширению сфер жизни.

---

## 8. API: минимальный каталог контрактов

Auth routes обслуживает Better Auth. Собственный API — версия `/api/v1`.

| Функция | Endpoint / интерфейс | Этап |
|---|---|---|
| Авторизация | `/api/auth/[...all]` | 2 |
| Dashboard | `GET /api/v1/dashboard` | 2 / 6 |
| Цели | `GET/POST /api/v1/goals`, `GET/PATCH/DELETE /api/v1/goals/{id}` | 2 |
| Ручные измерения | `GET/POST /api/v1/goals/{id}/measurements`, `PATCH/DELETE /api/v1/goal-measurements/{id}` | 2 |
| Telegram link | `POST /api/v1/telegram/link-token`, `POST /api/webhooks/telegram` | 3 |
| Языки | `GET/POST /api/v1/languages`, `GET/PATCH /api/v1/languages/{id}` | 4 |
| Tutor chat | `POST /api/v1/agents/tutor/messages` (Web stream) | 4 |
| Словарь | `GET/POST /api/v1/languages/{id}/vocabulary`, `PATCH/DELETE /api/v1/vocabulary/{entryId}` | 4 |
| Mini App auth | `POST /api/v1/telegram/miniapp/session` | 5 |
| Карточки | `GET /api/v1/languages/{id}/reviews/due`; `POST /api/v1/languages/{id}/reviews` | 5 |
| Уроки | `POST /api/v1/languages/{id}/lessons`, `POST /api/v1/lessons/{lessonId}/answers`, `POST /api/v1/lessons/{lessonId}/complete` | 6 |
| Прогресс | `GET /api/v1/languages/{id}/progress` | 6 |
| Platform chat | `POST /api/v1/agents/platform/messages` | 7 |
| Подтверждение tools | `POST /api/v1/tool-actions/{id}/confirm` / `reject` | 7 |
| Практика и задания | `GET /api/v1/languages/{id}/practice`, `/assignments` | 8 |
| Приватность | `POST /api/v1/privacy/export`, `POST /api/v1/privacy/delete-account` | 8 |

**Контрактные правила:** сессия и ownership проверяются на сервере; API DTO через Zod; cursor-pagination для историй; idempotency keys для повторяемых write-запросов; единая карта ошибок. После установки точных версий библиотек подготовить отдельный `docs/api/contracts.md`.

---

## 9. Требования к безопасности и качеству

### 9.1. Авторизация и разделение данных

- [ ] На любом read/write-запросе проверить владельца ресурса в domain/repository слое, **не** полагаться только на Route Handler или скрытие кнопки.
- [ ] На Telegram Mini App проверять подпись сырого `initData` на backend; `initDataUnsafe` не является доказательством личности.
- [ ] Для link токенов использовать одноразовость, ограниченное время, хранение хэша, запрет перепривязки чужого Telegram.
- [ ] Протестировать повторные webhook updates, сообщения и callbacks.
- [ ] Не логировать пароли, токены, личные аудиофайлы, полные приватные сообщения и чувствительный контекст.

### 9.2. AI безопасность

- [ ] Разрешённые tools заданы серверной матрицей, а не только текстом system prompt.
- [ ] Ответы LLM валидируются; tool-call с чужим `user_id` отклоняется независимо от аргументов модели.
- [ ] Любое изменение цели/настроек, имеющее последствия для данных, требует предусмотренного подтверждения.
- [ ] Некорректное или повторное подтверждение не может выполнить мутацию дважды.
- [ ] Prompt injection из сообщений, описаний карточек или записей в базе не отменяет авторизацию.
- [ ] Есть ограничение частоты, числа шагов, длины контекста и денежных расходов.

### 9.3. Reliability и данные

- [ ] Входящие webhook-события, worker jobs и FSRS review имеют идемпотентность.
- [ ] Для AI/worker фиксируются correlation IDs и статусы ошибок/повторов.
- [ ] Сохранение данных и постановка задачи в одной транзакции, где это поддерживает проверенная конфигурация pg-boss/Drizzle.
- [ ] Ежедневные резервные копии и успешный тест восстановления до MVP 0.3.
- [ ] Экспорт/удаление данных учитывают историю сообщений, карточки, связанные записи и off-site backups согласно выбранной политике хранения.
- [ ] Пользовательские даты отображаются по timezone, UTC в базе.

### 9.4. Тестовый минимум

| Тип | Примеры |
|---|---|
| Unit | расчёт целей, paused-time logic, нормализация слов, Zod-конвертеры |
| Integration | PostgreSQL ownership, транзакции, idempotent card reviews, Telegram linking |
| E2E | sign-in → Telegram → Tutor → vocabulary → review → dashboard |
| AI evals | качество исправлений, отсутствие вымышленных чисел, запрет tool, корректный handoff |
| Mobile smoke | Telegram WebView, маленькие экраны, flip карточек, повтор при сбое сети |

---

## 10. Критические сценарии приёмки MVP

| ID | Сценарий | Ожидаемый результат |
|---|---|---|
| AC-01 | Создать LifeOS-аккаунт | Войти можно только разрешённому email до открытия публичного SaaS |
| AC-02 | Создать цель «Накопить 50 000 NOK» и внести 12 000 | Dashboard показывает данные и происхождение «ручной ввод»; никакой фиктивной банковской синхронизации |
| AC-03 | Связать Telegram через deep link | Один Telegram ID связан с одним пользователем; повторный токен не работает |
| AC-04 | Добавить English и Norwegian | Уровни, словари, контексты, цели независимы |
| AC-05 | Общаться с Tutor | Tutor отвечает на целевом языке, корректно объясняет ошибки, учитывает профиль |
| AC-06 | Сохранить слово из чата | Появляется карточка в словаре; дубликаты по одному значению не множатся |
| AC-07 | Открыть Mini App и повторить слово | FSRS обновляет расписание один раз даже при повторной отправке запроса |
| AC-08 | Завершить структурированный урок | Упражнения оценены по рубрике, факт завершения сохранён, ошибки видны в Web |
| AC-09 | Посмотреть Dashboard | Уроки, практика, слова и регулярность равны результатам SQL-запросов из фактических записей |
| AC-10 | Спросить «Сколько я занимался?» | Platform Assistant использует tool, а не генерирует выдуманное число |
| AC-11 | Попросить изменить общую цель | Сначала preview/confirm, затем изменение и запись в audit |
| AC-12 | Отправить голосовое сообщение | Показана расшифровка; локальная копия аудио удалена; оценка произношения не выдумана |
| AC-13 | Пройти урок и повторить карточки в разные дни | Счётчики и due-карточки согласованы; потерянных и задвоенных действий нет |
| AC-14 | Попытаться прочесть чужой ресурс | 403/404 без утечки данных и без выполнения AI tool |
| AC-15 | Экспортировать/удалить данные | Процедура работает в рамках политики хранения и проверяется тестом |

**MVP считается готовым, если выполнены AC-01 — AC-15**, критические тесты проходят, резервная копия восстановлена в тестовой среде, а продукт прошёл личный пилот на реальном устройстве Telegram.

---

## 11. Post-MVP: как LifeOS станет полноценной платформой

Эти работы **не входят в восемь этапов до MVP**, но влияют на архитектуру. Их следует превращать в отдельные Epic после стабильного релиза 0.3 и фактического использования LifeOS.

### Дорожная карта расширения сфер

| Следующий модуль | Первая полезная версия | Интеграции / AI позже |
|---|---|---|
| **Projects** | проекты, задачи, Kanban Backlog → In Progress → Done, этапы, сроки, прогресс | AI-декомпозиция проекта, интеграция GitHub/Calendar, оценка рисков |
| **Work & Career** | рабочие задачи, цели развития, компетенции, достижения | календарь, CV/отклики, career coach, интеграции задач |
| **Finance** | счета вручную, операции, бюджет, долги, финансовые цели, CSV-import | Open Banking через лицензированного провайдера с согласием пользователя, авто-категоризация, прогнозы |
| **Skills** | дерево навыков, учебные программы, проверки, портфолио доказательств | генерация упражнений/диагностики, специализированные Tutor-конфигурации |
| **Health & Fitness** | ручные тренировки, планы, привычки, сон и активность | интеграции с устройствами при доступности, безопасные рекомендации без медицинских диагнозов |
| **Integrations Hub** | каталог коннекторов, scopes, sync status, revoke | расширение провайдеров и автоматизация |
| **SaaS** | открытая регистрация, изоляция данных, onboarding, мониторинг и биллинг | тарифы, квоты, командные аккаунты только при спросе |

### Что обязано масштабироваться без переделки ядра

- **Core:** цели, измерения, события, пользовательские права, Dashboard.
- **AI Runtime:** новый агент — это configuration + context + разрешённые typed tools; не новый независимый backend.
- **Integration architecture:** импорт создаёт верифицируемые записи с provenance и idempotency, а не «волшебное изменение процента».
- **Module contracts:** каждый модуль определяет UI, допустимые цели/метрики и права, но не изобретает заново auth и AI.
- **Privacy:** отдельные разрешения доступа к финансам и здоровью, даже если пользователь один.

### Измерение «уровня жизни»

Не выводить один глобальный `% успешности` автоматически. В будущем можно предложить пользовательский **Life Overview Score** как настраиваемое агрегирование только выбранных и методологически сопоставимых целей — с прозрачными весами, источниками и возможностью вовсе отключить показатель. На MVP достаточно независимых карточек сфер и прогресса конкретных целей.

---

## 12. Работа с Codex: формат следующих задач

### Правила выполнения

1. Один этап — набор небольших задач, а не один гигантский запрос «сделай LifeOS».
2. Каждая задача получает файл `docs/tasks/LFS-XXX.md`.
3. Сначала уточнить/зафиксировать **contract**, затем миграции, затем domain tests, затем API, затем UI, затем E2E.
4. AI/Codex не должен молча менять ADR или scope другого этапа.
5. Если меняется схема данных, приложить миграцию и тест; если меняется tool, обновить Zod, permissions и evals.
6. После завершения — короткий отчёт: изменённые файлы, тесты, миграции, риски, что делать далее.

### Шаблон задачи

```md
# LFS-XXX — Название

## Зачем
Один проверяемый результат.

## Зависимости
Ссылки на предыдущие задачи / ADR.

## Область изменений
- apps/web/...
- packages/domain/...
- packages/db/...

## Требования
- [ ] ...

## Acceptance criteria
- [ ] ...

## Тесты
- [ ] Unit / Integration / E2E

## Вне scope
Что не реализуем в этой задаче.

## Definition of Done
Типы, линтер, тесты, миграции, документация.
```

### Обязательные проектные документы до реализации соответствующих задач

- `docs/architecture/system.md` — компоненты, data flow, деплой, boundaries.
- `docs/architecture/database-schema.md` — ERD, модель авторизации, миграции, индексы.
- `docs/api/contracts.md` — Zod DTO, auth, ошибки, idempotency.
- `docs/architecture/ai-runtime.md` — agent/tool registry, prompt versions, budgets, evals.
- `docs/architecture/progress.md` — формулы, провайдеры метрик и источники.
- `docs/adr/` — фиксированные версии и отклонения от Claude PRD v0.3.

---

## 13. Решения, которые ещё нужно зафиксировать (не блокируют старт этапа 1)

| Вопрос | Рекомендуемый default | Когда окончательно решить |
|---|---|---|
| Hosting | VPS в ЕС, Docker Compose | Этап 1 / 8 |
| Название и бренд | Временное LifeOS; реальный бренд проверить перед публичным SaaS | До SaaS |
| Node/зависимости | Поддерживаемая LTS с проверкой всех пакетов, включая Node >=24 для актуального `ts-fsrs` v6 | Этап 1 |
| Где открыть Mini App | `/telegram/*` на том же домене Next.js | Этап 1 |
| Язык первого Tutor | Первый профиль настраивается; английский и норвежский одинаково поддерживаются как data-driven profiles | Этап 4 |
| AI-модель | Конфигурация на агента через env, выбор по качеству и цене на evals | Этап 3 |
| Ручные цели | Доступны во всех сферах, пользователь вводит замеры сам | Этап 2 |
| Модель подтверждения tools | Использовать lifecycle в `ai_tool_calls`; отдельная таблица только при нехватке полей | Этап 7 |
| Голос | Async STT для Telegram; realtime-voice позже | Этап 8 |
| Проекции метрик | Не вводить, пока реальные запросы не станут проблемой | После MVP |
| Multi-user / billing | Ownership с первого дня, публичный onboarding и платежи после пилота | После MVP |

---

## 14. Практический порядок старта

1. **Утвердить этот документ как план**, не превращая его целиком в промпт для разработки.
2. Сначала выполнить **Этап 1**: версии, monorepo, PostgreSQL, очередь, CI и архитектурные контракты.
3. Затем **Этап 2**: базовый LifeOS Dashboard и ручные цели; это покажет общую идею продукта ещё до Tutor.
4. Этапами **3–4** выпустить и реально использовать **MVP 0.1**.
5. На основе первых реальных диалогов скорректировать качество Tutor, затем выполнить **5–6** и получить **MVP 0.2**.
6. Реализовать центрального ассистента, голос, задания, приватность и надёжность на этапах **7–8**; получить **MVP 0.3**.
7. Только после этого расширять **Projects / Work / Finance / Skills / Health** на основании фактического использования и приоритетов.

**Итоговая формула продукта:** `LifeOS Core + Goals + Progress + AI Runtime + Modular Domains + Integrations`. **Language Tutor / Telegram — первый полноценный модуль и первый канал, который доказывает архитектуру на практике.**

---

## 15. Источники и статус допущений

**Исходный материал пользователя:** `LifeOS — PRD v0.3 (1).md`, подготовленный Claude (2026-11-06). Из него взяты основные библиотеки, подход к агентам, алгоритму повторений, очередям, Telegram и этапам языкового обучения. Сферы LifeOS, ручные кросс-доменные цели, новые границы релизов и 8-этапная декомпозиция — решения/рекомендации **этого** плана v0.4.

**Официальная документация (проверено 2026-11-06):**

- [Next.js — Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups)
- [Better Auth — Next.js Integration](https://better-auth.com/docs/integrations/next)
- [Better Auth — Drizzle Adapter](https://better-auth.com/docs/adapters/drizzle)
- [pg-boss — Docs](https://github.com/timgit/pg-boss/blob/master/docs/index.md)
- [pg-boss — Database backends / Drizzle transactions](https://github.com/timgit/pg-boss/blob/master/docs/database-backends.md)
- [Telegram Mini Apps](https://core.telegram.org/bots/webapps)
- [Telegram Mini Apps initData validation](https://docs.telegram-mini-apps.com/platform/init-data)
- [AI SDK — Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [ts-fsrs — README and runtime requirements](https://github.com/open-spaced-repetition/ts-fsrs/blob/main/README.md)

**Принцип версионирования:** v0.4 — план, **не** утверждение о том, что код, тесты, таблицы или интеграции уже созданы. Конкретные реализации и новые ограничения фиксируются в ADR и задачах до написания кода.
