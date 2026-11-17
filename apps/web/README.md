# @lifeos/web

Единое Next.js приложение для Web, будущего Telegram Mini App и HTTP API.
В LFS-103 настроены App Router, strict TypeScript, Tailwind 4 и shadcn/ui.

Здесь располагаются интерфейсы, HTTP-адаптеры, transport/auth и композиция.
Бизнес-правила принадлежат пакетам. Будущий URL Mini App — `/telegram/*`;
route group `(telegram)` сама по себе не добавляет сегмент URL.

## Маршруты и состояния

- `/`: Web layout и карточки шести сфер из `LIFE_DOMAINS` (LFS-203).
  Навигация и карточки ведут на стабильные URL `/domains/<key>`;
  `/#areas` остаётся обзором, отдельной страницы `/domains` нет.
- `/domains/languages`, `/domains/finance`, `/domains/work`, `/domains/projects`,
  `/domains/skills`, `/domains/health`: публичные страницы метаданных с честными
  описанием общих целей и заглушкой специализированного модуля. Персональных
  данных нет; ссылки ведут в список и создание с выбранной сферой (LFS-208).
  Неизвестный/неканонический ключ — 404.
  Иконки и цвета маппятся только в `lib/domain-presentation.ts`; названия,
  описания, ключи и URL берутся из domain. `NavigationLink` отмечает текущий URL.
- `/auth/sign-in`, `/auth/sign-up`, `/auth/forgot-password`, `/auth/reset-password`:
  формы аккаунта (LFS-201) через Better Auth client, валидация `@lifeos/contracts`,
  ошибки в `role=alert`, защита от повторной отправки.
- `/dashboard`, `/goals`, `/settings`: только с сессией — `requirePageSession()`/`requirePageUser()`
  на странице и оптимистичный `proxy.ts` (307 гостю без cookie). Dashboard пока
  без сводных данных; `/settings` (LFS-202) показывает и меняет timezone/locale.
- LFS-208: `/goals` — фильтры по сфере/статусу и cursor pages, `/goals/new` —
  создание, `/goals/[id]` — прогресс, metadata edit, archive, история и
  add/edit/delete измерений. Каждая страница проверяет сессию; данные и все
  мутации целей идут через API LFS-207, не через server actions/прямой SQL.
- `/telegram`: отдельный компактный layout и явная заглушка Mini App.
- `GET /api/health`: HTTP 200 с envelope `data/meta/errors`; `data` содержит
  `status`, `service`, `timestamp`, `meta` — request/correlation ID; `no-store`,
  без проверки БД. Другие методы, кроме автоматического HEAD, не добавлены.
- `/api/auth/*`: Better Auth; `GET /api/v1/me`: текущий пользователь, 401 без сессии.
- `GET/PATCH /api/v1/me/preferences` (LFS-202): свои timezone/locale; actor только из
  сессии (`requireApiActor`), body валидирует domain-сервис ([ADR-006](../../docs/adr/006-actor-ownership.md)).
- LFS-207: `GET/POST /api/v1/goals`, `GET/PATCH /api/v1/goals/:goalId`,
  `GET/POST /api/v1/goals/:goalId/measurements`,
  `PATCH/DELETE /api/v1/goal-measurements/:measurementId`. `server/goals.ts`
  — HTTP adapter; `server/core.ts` — lazy composition; проценты/ownership —
  в domain, snapshot SQL — в DB. Записи требуют Idempotency-Key,
  POST/PATCH — JSON; archive отдельным PATCH status. Все успехи 200,
  ошибки 400/401/404/409/500 в общем envelope, no-store.
  [Контракт/пагинация](../../docs/api/contracts.md#http-целей-и-прогресс-lfs-207),
  [ADR-010](../../docs/adr/010-goals-api-progress.md).
- Неизвестные URL: 404 с возвратом на главную. Предусмотрены loading и
  безопасная error boundary без вывода внутренних ошибок или логирования payload.

Единственный root layout — `app/layout.tsx`. Route groups `(web)` и
`(telegram)` разделяют UX; публичный сегмент Mini App расположен в
`app/(telegram)/telegram/page.tsx`; страницы аккаунта — в `(auth)`.
Композиция Better Auth — `server/auth`, отправка писем — `server/mail`
(outbox для dev/test, SMTP для production); [ADR-005](../../docs/adr/005-auth.md).
Telegram SDK и внешние интеграции отсутствуют; ручные цели и измерения
доступны через API и UI целей.

Тесты: `pnpm --filter @lifeos/web test` (unit, без БД) и `pnpm test:web`
(Better Auth + PostgreSQL, только `TEST_DATABASE_URL`). Для новых owned-ресурсов —
`tests/integration/support/auth-harness.ts` (изолированная schema, Better Auth,
пользователи) и `support/ownership-contract.ts` (двухпользовательские 401/404-проверки).
Композиция domain-сервисов — `server/core.ts`.

## Формы целей · LFS-208

`components/goals` использует общие strict DTO для валидации и API response
schemas. Процент не пересчитывается в браузере. Без измерений показывается
«Недостаточно данных», с данными — current/target, процент и ручной источник.
Archive запрещает редактирование и сохраняет историю. Modal подтверждения
используют native dialog (focus trap/Escape/возврат фокуса), поля имеют label,
aria-invalid/описания; ошибки получают focus и role=alert, успех — role=status.
После мутации detail и history заново читаются через no-store API.

Decimal inputs — text/inputMode=decimal: запятая нормализуется в точку,
суммы не преобразуются в Number. Integer группируется как BigInt, дробная
часть сохраняется строкой. Время native datetime-local относится к account
timezone; offset вычисляется по IANA, nonexistent DST время отклоняется,
ambiguous требует выбора смещения. Milliseconds сохраняются при edit.

В одной открытой форме синхронный lock блокирует double submit. При network,
500 или непроверяемом ответе body/key сохраняются в памяти для точного
повтора; поля и закрытие modal блокируются до результата. Definitive 400/404/
409 позволяет исправить данные с новым ключом; 401 ведёт на sign-in.
Ключи и payload не пишутся в local/session storage или логи; перезагрузка
вкладки сбрасывает локальную незавершённую попытку. После неопределённого
ответа следует повторить сохранение в той же форме, а не создавать новый запрос.

`pnpm test:ui` собирает приложения и запускает Playwright на отдельной fresh
schema TEST_DATABASE_URL с реальными Better Auth сессиями (shared fixture
secret), closed signup и synthetic SMTP URL. Production rate limit не меняется.
Edge channel используется на Windows, Chromium на Linux (нужен установленный
браузер, `PLAYWRIGHT_CHANNEL` может выбрать другой доступный channel).
390×844 и 1280×900: empty/auth/ownership, create→24%, edit/delete/archive,
точные NOK, потерянный ответ после server commit с тем же key/одной записью,
блокировка до завершения navigation и Tab/Shift+Tab/Escape с возвратом фокуса.
Unit/component/form tests включают TSX без нового DOM/testing dependency.
Runner и manual mode: `scripts/test-goals-ui.ts`; артефакты только в ignored
`.cache/lfs208`. `--serve` создаёт временную БД-схему и печатает loopback URL
для визуального QA. Тестовый proxy подставляет только disposable session и
не меняет cookies пользовательского браузера (Set-Cookie не передаётся).
Файл `.cache/lfs208/stop-manual` завершает proxy/server и cleanup известных
таблиц через RESTRICT. Этот режим не является частью production приложения.

## Дизайн и компоненты

Токены цветов, типографики, отступов, скруглений и focus находятся в
`app/globals.css`. Шрифты системные, внешние font-запросы не требуются.
Настроены skip-link, семантические landmarks, клавиатурный focus,
адаптивные grid layouts и `prefers-reduced-motion`.

`components.json` использует shadcn `base-nova`, RSC и Tailwind CSS variables.
Card и Skeleton добавлены официальным CLI **4.23.0**:

```sh
pnpm --filter @lifeos/web exec shadcn add card skeleton --yes
```

Исходники компонентов хранятся в `components/ui`; EmptyState, Brand и
навигация — локальные presentation-компоненты. Список ссылок на сферы
нужен только для UI: доменный registry будет реализован на этапе 2.

## Команды

Из корня на Node.js 24.22.2 / pnpm 10.34.9:

```sh
pnpm dev
pnpm lint
pnpm typecheck
pnpm build
pnpm --filter @lifeos/web start
```

В PowerShell при запрете `.ps1` используйте `pnpm.cmd`. Root `dev` запускает
только Web на `http://127.0.0.1:3000`; worker автоматически не запускается.
`next typegen` подготавливает route types перед `tsc`; `next-env.d.ts`,
`.next` и `*.tsbuildinfo` генерируются и игнорируются Git. Web включает
ES2024 lib для совместимости с типами Next 16.4.5, сохраняя strict.
Рекомендованный Next `skipLibCheck` исключает конфликт ambient declarations
между `.next/types` и `.next/dev/types` после чередования dev/build.
Исходные `.ts`/`.tsx` и сгенерированный route validator проверяются;
общий tsconfig пакетов этим флагом не изменён.
Общий ESLint config экспортируется из `@lifeos/config/eslint/base`, Next
plugin подключён локально. Stable `jiti` загружает TypeScript-конфиги ESLint.

В LFS-106 `test` запускает Vitest: env проверяется отдельно в config,
здесь проверяются HTTP envelopes, DTO/JSON validation, 200/400/404/500,
все коды mapper, безопасные логи и перенос context в job DTO.

`server/api-route.ts` — тонкий HTTP-helper, `server/api-error.ts` — фиксированная
карта ошибок. `scripts/run-next.ts` проверяет env до загрузки Next CLI;
`instrumentation.ts` дополнительно вызывает server-only validation, пропуская
build phase. Прямой `next start` может напечатать Ready до окончания hook,
поэтому используйте workspace scripts. Dev/start загружают root
`.env` через `process.loadEnvFile` внутри launcher, без `--env-file-if-exists`
в аргументах Node (иначе Next 16.4.5 переносит его в `NODE_OPTIONS` dev-процесса).
Launcher задаёт default `NODE_ENV` как Next CLI (`development` для dev,
`production` для start) до валидации и требует валидный `DATABASE_URL`,
не подключаясь к БД. Для локального outbox нужен `pnpm dev`; `start` требует SMTP
и отклоняет outbox до открытия порта.
Импорт env в client components запрещён. Подробности:
[API-контракт](../../docs/api/contracts.md).

## Проверки LFS-103

На Windows x64 / Node 24.22.2 проверены lint, typecheck, production build и
запуск root `dev`. HTTP-проверки подтвердили 200 для `/`, `/telegram`,
`/api/health`, безопасную схему health с актуальным ISO timestamp, 405 для
POST health и 404 для неизвестного URL / пути с названием route group.

Визуальная проверка браузера, ручной keyboard smoke и мобильный скриншот
**NOT RUN**: Computer Use остановлен защитой, поскольку текущий URL Chrome
не удалось надёжно определить. Адаптивная разметка и focus реализованы,
но визуальная приёмка остаётся ручной: открыть три URL, проверить ширину
360–390 px, Tab/Shift+Tab, skip-link, ссылки на сферы и возврат из Telegram.

Установка и ограничения: [корневой README](../../README.md#окружение-lfs-102).

## Handoff LFS-109

HTTP/production smoke повторно прошёл в полной verify chain. Визуальная,
keyboard и mobile приёмка остаётся NOT RUN: новая попытка Browser Use вернула
`The browser access host is unavailable`, browser inventory пуст. Эти ограничения
не заменяются HTTP 200. Layout/URL decision: [ADR-004](../../docs/adr/004-next-routing.md),
актуальная приёмка: [Stage 1](../../docs/tasks/STAGE-01-ACCEPTANCE.md).
