# LifeOS Foundation: система и границы

Состояние LFS-202: технический Foundation плюс аккаунты (Better Auth:
закрытая регистрация, вход/выход, восстановление доступа, защищённые маршруты;
[ADR-005](../adr/005-auth.md)), timezone/locale пользователя и общее правило
actor/ownership ([ADR-006](../adr/006-actor-ownership.md)). Рабочих модулей Languages/Finance/Work/Projects/
Skills/Health, целей и персонального Dashboard пока нет. Названия шести сфер в
UI — presentation-only anchor links, а не доменный registry. Источник продуктового плана —
[Master Plan v0.4](../reference/LifeOS_Master_Plan_v0.4.md); его формулировки здесь не меняются.

## Процессы и поток данных

```mermaid
flowchart LR
  browser["Browser"] --> web["Next.js Web / API<br/>apps/web"]
  web --> health["GET /api/health<br/>HTTP adapter"]
  health --> contracts["packages/contracts<br/>Zod DTO / IDs / errors"]
  producer["Node demo CLI"] --> queue["pg-boss"]
  worker["Node worker<br/>apps/worker"] --> queue
  queue --> pg["PostgreSQL<br/>queue schema"]
  cli["Node migration CLI"] --> db["packages/db<br/>Drizzle / pg / migrator"]
  db --> appdb["PostgreSQL<br/>fixture + migration journal"]
  web --> authroute["/api/auth/* · /api/v1/me<br/>Better Auth (apps/web/server/auth)"]
  authroute --> domain["packages/domain<br/>signup allowlist policy"]
  authroute --> db
  authroute --> mail["Mail sender<br/>outbox (dev) / SMTP (prod)"]
  health -. "future application use cases" .-> domain
  domain -. "future repository ports" .-> db
  domain -. "future enqueue composition" .-> queue
```

Сплошные связи исполняются сейчас. Пунктир показывает направление будущей
композиции и не обозначает готовые use cases или HTTP producer. Обе части
PostgreSQL находятся в одной application DB; локальная test DB — отдельный
instance. HTTP health не выполняет SQL и не проверяет доступность очереди.

Web, worker и producer CLI — отдельные Node процессы. `pnpm dev` запускает
только Web и build его dependencies; worker запускается отдельно через
`pnpm worker:dev` / `pnpm worker:start`. Worker не стартует из route handler,
React render или instrumentation. Доменная логика не должна зависеть от
жизненного цикла HTTP-запроса.

## Пакеты и разрешённые зависимости

| Путь | Текущая роль | Граница |
|---|---|---|
| `apps/web` | React UI, Next routes/layouts, HTTP helper/error mapper, startup composition; Better Auth composition, mail transports, auth pages и guards | Transport/auth adapters; бизнес-правила остаются в пакетах |
| `apps/worker` | PgBoss lifecycle, demo handler, producer CLI, безопасные технические логи | Не импортирует Web; будущие application/domain functions подключаются через пакеты |
| `packages/contracts` | Zod schemas, inferred DTO/types, health envelope, IDs и demo payload | Нет зависимости от apps, React, Next или env; можно использовать в browser |
| `packages/config` | Strict tsconfig, ESLint config; отдельный Node export `./env` | Tooling exports не читают env; runtime parser вызывается явно |
| `packages/db` | Drizzle schema (fixture + Better Auth tables), pg client factory, защитные DB helpers; migrator — отдельный entry `@lifeos/db/migrations` | Репозитории бизнес-моделей ещё не реализованы; module import не открывает соединение |
| `packages/domain` | Framework-independent правила: закрытая регистрация (`createSignupPolicy`); build/test/lint/typecheck | Нет Next/React/apps imports, Node API в исходниках (build без Node types), SQL и обхода repositories |

Web и worker объявляют зависимости на DB/config/contracts в manifests.
В текущем production Web нет использования DB client. Production worker
обращается к очереди через pg-boss, а не через application Drizzle client;
общая Drizzle transaction продемонстрирована только integration fixture.
Пакеты не зависят от приложений; приложения не экспортируются как библиотеки.

Application layer — правило размещения будущих use cases внутри packages,
не отдельный уже существующий `packages/application` или backend service.
Языковой учитель не определяет архитектуру всей платформы. Новые Redis,
NestJS/Prisma, микросервисы или другой стек требуют отдельного согласованного ADR.

## Web, маршруты и состояния

| URL | Файл | Текущее поведение |
|---|---|---|
| `/` | `apps/web/app/(web)/page.tsx` | Обзор шести сфер из кодового реестра, без персональных чисел/процентов |
| `/domains/<key>` (ровно 6 ключей) | `apps/web/app/(web)/domains/[domainKey]/page.tsx` | Публичные страницы метаданных; заглушки общих целей и будущего специализированного модуля; неизвестный ключ — 404 |
| `/telegram` | `apps/web/app/(telegram)/telegram/page.tsx` | Компактная заглушка Mini App, без Telegram SDK/linking |
| `/api/health` | `apps/web/app/api/health/route.ts` | Dynamic JSON envelope, текущий ISO timestamp, no-store, request/correlation ID |
| `/api/auth/*` | `apps/web/app/api/auth/[...all]/route.ts` | Better Auth: sign-up/sign-in/sign-out/session/password reset |
| `/api/v1/me` | `apps/web/app/api/v1/me/route.ts` | Текущий пользователь в envelope; 401 без сессии |
| `/auth/sign-in`, `/auth/sign-up`, `/auth/forgot-password`, `/auth/reset-password` | `apps/web/app/(auth)/auth/*` | Формы через Better Auth client; валидация `@lifeos/contracts` |
| `/dashboard`, `/goals` | `apps/web/app/(web)/dashboard`, `goals` | Только с сессией: `requirePageUser()`/`requirePageSession()` на странице + оптимистичный `proxy.ts` (307 гостю). `/dashboard` — шесть сфер, сроки и последние действия (LFS-204) |
| `/api/v1/dashboard` | `apps/web/app/api/v1/dashboard/route.ts` | Read model Dashboard владельца; 401 без сессии, 400 на любой query |
| Неизвестный URL | `apps/web/app/not-found.tsx` | HTML 404 |

Единственный root layout — `app/layout.tsx`; `(web)` и `(telegram)` выбирают
внутренние layouts, но не добавляют URL segments. Явная папка `telegram`
создаёт реальный путь `/telegram`; будущие Mini App routes должны быть
`/telegram/*`. Путь `/(telegram)/telegram` не является маршрутом.
Есть loading/error boundaries, skip-link, focus styles и responsive CSS.
Визуальную/keyboard/mobile приёмку следует отличать от HTTP smoke.

LFS-203: `DOMAIN_KEYS` и Zod `domainKeySchema` находятся в contracts;
domain строит по ним `LIFE_DOMAINS` с локализуемыми названиями/описаниями,
статусом, capabilities и стабильными URL. `available` относится к общей
модели ручных целей, `specializedAvailable` во всём Stage 2 — false.
Web отдельно сопоставляет ключам иконки/цвета. Общие цели и Dashboard
реализуются следующими задачами; страницы реестра не читают БД. Дополнительной
страницы-обзора `/domains`, таблицы `domains` или плагинной системы нет.

## Env, сборка и imports

`apps/web/scripts/run-next.ts` в Web dev/start проверяет env до загрузки Next CLI.
Дополнительная server-only проверка находится в `instrumentation.ts` и
пропускает build phase. Это важно для Next 16.4.5: одно только instrumentation
может завершиться после сообщения Ready. Worker/producer проверяют env до
создания runtime; DB CLI — до pool. Root `.env` загружается средствами Node,
process env имеет приоритет. Конфиги и ошибки описаны в [API contracts](../api/contracts.md).

`pnpm build` создаёт Web `.next`, worker `dist` и ESM/declarations общих пакетов.
Tooling config экспортируется напрямую. Native Node 24 исполняет TypeScript
CLI/dev scripts; source imports не должны создавать pools или проверять
секреты на стадии сборки. Strict TypeScript включён во всех workspace;
локальный skipLibCheck у Next/Drizzle consumers описан в [ADR-001](../adr/001-stack.md).

Secrets не передаются в client props, NEXT_PUBLIC_* или next.config.env.
HTTP logs содержат allowlisted technical fields; SQL, raw payload и upstream
exceptions наружу не передаются. Actor определяется только серверной
cookie-сессией Better Auth (`requirePageSession`/`requireApiActor` → branded
`Actor` из `@lifeos/domain`). Repositories фильтруют персональные записи по
`user_id = actor.userId` (`ownedBy`), services отвечают `NotFoundError` на чужое
и отсутствующее одинаково (HTTP 404) — [ADR-006](../adr/006-actor-ownership.md).
Provenance персональных данных вводится вместе с goals/measurements (LFS-205+).

LFS-205: contracts содержит goal DTO/decimal правила; domain — `GoalsService`
и repository port; DB — SQL schema и actor-scoped repository, пригодный также
для Drizzle transaction. DB имеет runtime dependency на contracts (те же
ключи/лимиты), dependency на domain используется только для типов. Циклов
нет. Схема и политика — [ADR-007](../adr/007-goals.md); HTTP/API/UI целей,
UI вводится отдельно в LFS-208; API и прогресс подключены в LFS-207.

LFS-210: goal service использует `GoalsUnitOfWork`. В одной Drizzle transaction
сохраняются goal mutation, append-only activity event и idempotency receipt.
DB берёт transaction-scoped advisory key lock и SELECT FOR UPDATE родительской
цели. Domain формирует whitelisted before/after; DB обеспечивает atomicity,
FK ownership и durable replay. Никакой очереди, event sourcing, projection
или нового runtime. Source web/manual назначается сервером; Telegram/import/
AI остаются зарезервированы. [ADR-008](../adr/008-transactional-audit.md).

LFS-206: measurement service и DB UOW используют ту же transactional границу.
Parent goal блокируется перед child; actor/parent unit защищены compound FK.
Точные измерения, current по measured_at/created_at/id и минимальный аудит
не требуют projection/worker. Общий receipt расширен target/resource полями
для replay удаления. Без измерений current=null, проценты ещё не считаются.
[ADR-009](../adr/009-goal-measurements.md).

LFS-207: восемь HTTP операций `/api/v1/goals*` и
`/api/v1/goal-measurements/:id` используют существующие auth/envelope и
write UOW. `GoalsReader` через DB repository читает repeatable-read snapshot
и передаёт данные чистому BigInt progress calculator в domain. Это обычные
SQL read queries, без projection/очереди. Detail и list содержат methodology,
manual self-report provenance, count и последнее время изменения. History
и goal list имеют bounded cursor pagination. [ADR-010](../adr/010-goals-api-progress.md).

LFS-208: RSC pages `/goals`, `/goals/new`, `/goals/[id]` проверяют сессию и
передают только user preferences/public domain choices в Client Components.
Все goal reads/writes идут через API LFS-207. Client formatting не вычисляет
progress; exact decimal и account-timezone представление отделены от domain.
Mutation state удерживает один key/body при неопределённом ответе, не создаёт
browser persistence личных payload. Новый backend/runtime/DDL не вводится.

LFS-204: `createDashboardReader` (domain) строит Dashboard из реестра
`LIFE_DOMAINS`, общего `goalDetailsFromRecord` (тот же GoalDetails, что у
GoalsReader) и нормализованных `activity_events`; чужие события скрываются,
чужая цель от адаптера — NOT_FOUND. DB `createDashboardReadRepository` читает
один repeatable-read snapshot: counts по сфере/статусу, до 5 новейших активных
целей на сферу (`row_number() over (partition by domain_key)`), ближайшие сроки,
общий трёхзапросный summary целей и события с JOIN на цель владельца. Число
запросов фиксировано и не зависит от числа целей. `/dashboard` — RSC с
проверкой сессии и Client Component, читающий `GET /api/v1/dashboard`
(loading/error/retry/empty). Миграций, projection и очереди нет.

LFS-212: только presentation-слой Web. Общий UI-kit в `apps/web/components/ui`
(PageHeader, SectionCard, StatCard, SourceLabel, ProgressBar, DomainIcon,
StatusChip, SegmentedChoice) по [UI_GUIDELINES](../UI_GUIDELINES.md); цвета только
токенами `globals.css`, что проверяет ESLint-правило `lifeos-ui/no-color-literals`.
«Новая цель» — parallel slot `app/(web)/@modal` с intercepting route `(.)goals/new`:
та же RSC-проверка сессии и тот же POST `/api/v1/goals`, но форма показывается
диалогом поверх текущей страницы; прямой заход на `/goals/new` рендерит страницу.
API, контракты, схема БД и runtime не менялись.

## Проверка и handoff

Полная цепочка — `pnpm verify`: frozen install, lint/types, unit, test
migrations, PostgreSQL integration, builds и build smoke. CI и ограничения:
[CI](../CI.md). Модель данных: [database schema](database-schema.md).
Очередь/транзакции: [worker](worker.md). Процесс работы:
[development workflow](../DEVELOPMENT_WORKFLOW.md).
Фактическая приёмка и незакрытые пункты —
[Stage 1 acceptance](../tasks/STAGE-01-ACCEPTANCE.md).
