# LifeOS · Foundation + Stage 2 (в работе)

LifeOS — модульная платформа целей и развития в сферах Languages, Finance,
Work, Projects, Skills и Health. Языковой учитель — будущий модуль платформы.
Реализован технический Foundation (Web shell, PostgreSQL/Drizzle, demo-worker
pg-boss, контракты/env, atomicity tests, CI workflow) и из Stage 2 — аккаунты
LFS-201: закрытая регистрация по allowlist, вход/выход, восстановление доступа,
защищённые `/dashboard` и `/goals` ([ADR-005](docs/adr/005-auth.md)).
LFS-202 добавила настройки профиля и ownership ([ADR-006](docs/adr/006-actor-ownership.md));
LFS-203 — типизированный реестр шести сфер с навигацией и страницами метаданных.
LFS-205 добавила таблицу и domain-сервис ручных целей ([ADR-007](docs/adr/007-goals.md)).
LFS-210 связала изменения целей с транзакционным аудитом и защитой повторов
([ADR-008](docs/adr/008-transactional-audit.md)).
LFS-206 добавила ручные измерения, историю и выбор current с аудитом
([ADR-009](docs/adr/009-goal-measurements.md)).
LFS-207 открыла защищённый HTTP API целей/измерений и точный расчёт прогресса
([ADR-010](docs/adr/010-goals-api-progress.md)).
LFS-208 добавила Web UI целей и ручных измерений: список, создание, детали,
исправление истории и архив. LFS-211 перевела UI на Design System v2
([ADR-011](docs/adr/011-design-system-v2.md)). LFS-204 добавила Dashboard шести
сфер: точные счётчики, прогресс конкретных целей, сроки и последние действия
из аудита — без общего процента. Telegram SDK и AI ещё не реализованы.

LFS-101–109 проверены по [листу приёмки](docs/tasks/STAGE-01-ACCEPTANCE.md).
Локальная полная цепочка проходит; hosted GitHub Actions, visual/keyboard/mobile
и воспроизведение всего Foundation из remote clone пока не подтверждены.
Stage 2 автоматически не начинается. Продуктовый источник:
[Master Plan v0.4](docs/reference/LifeOS_Master_Plan_v0.4.md), без изменения его формулировок.

## Документация

| Документ | Содержание |
|---|---|
| [System](docs/architecture/system.md) | Процессы, package/import boundaries, реальные и будущие потоки |
| [Database](docs/architecture/database-schema.md) | Технические таблицы, test-only schemas и отдельно план Stage 2 |
| [Worker](docs/architecture/worker.md) | Demo lifecycle, retries/shutdown, atomic enqueue и ограничения |
| [API contracts](docs/api/contracts.md) | Envelope, errors, IDs, health и env |
| [CI](docs/CI.md) | Общая verify chain, PostgreSQL service, cache и реальные статусы |
| [Development workflow](docs/DEVELOPMENT_WORKFLOW.md) | Один LFS-ID, ветки/commits/PR, review и handoff |

## Каркас LFS-101

pnpm workspaces + Turborepo, strict TypeScript. Один Next.js App Router
обслуживает Web, будущий Mini App и API; worker — отдельный Node процесс.
PostgreSQL + Drizzle + pg-boss, без Redis и отдельного backend framework.

| Путь | Workspace | Сейчас |
|---|---|---|
| `apps/web` | @lifeos/web | UI shell, /telegram placeholder, health и HTTP adapters |
| `apps/worker` | @lifeos/worker | PgBoss demo runtime и producer CLI |
| `packages/db` | @lifeos/db | Drizzle schema/client/migrator; business repositories позже |
| `packages/domain` | @lifeos/domain | Framework-independent auth/core, ownership, preferences и реестр шести сфер |
| `packages/contracts` | @lifeos/contracts | Zod DTO, errors, health и request/job context |
| `packages/config` | @lifeos/config | TS/ESLint и отдельный серверный env export |

## Окружение LFS-102

Точные версии: **Node.js 24.22.2**, **pnpm 10.34.9**, PostgreSQL 18.6
с immutable image digest. Next/React/Drizzle/pg-boss и совместимость:
[ADR-001](docs/adr/001-stack.md). Не отключайте engine/peer checks и не
заменяйте версии на latest. `verify` требует точную Node из `.nvmrc`.

### Windows 11 / PowerShell

Установите и запустите [Docker Desktop с WSL2 backend](https://docs.docker.com/desktop/setup/install/windows-install/).
Если WSL ещё не настроен, выполните `wsl --install` в административном
PowerShell согласно установщику Windows, затем перезагрузитесь и включите
нужную дистрибуцию в Docker Desktop WSL integration. Проверьте:

```powershell
wsl --status
docker version
docker compose version
```

Для Node используйте [официальный 24.22.2 x64 MSI](https://nodejs.org/dist/v24.22.2/node-v24.22.2-x64.msi)
или уже установленный nvm-windows из корня проекта:

```powershell
$taskNodeVersion = (Get-Content -Raw .nvmrc).Trim()
nvm install $taskNodeVersion
nvm use $taskNodeVersion
node --version
```

Для ARM64 нужен соответствующий официальный Node binary. Системный Node
24.22.1 текущего окружения ниже pin и проверками не подменялся; локальный
portable runtime использовался только для фактической валидации.

Если Corepack есть, создайте project-local pnpm shims без изменения глобального PATH:

```powershell
New-Item -ItemType Directory -Force .cache/bin | Out-Null
corepack enable --install-directory .cache/bin pnpm
$env:Path = (Join-Path (Get-Location) '.cache/bin') + [IO.Path]::PathSeparator + $env:Path
pnpm.cmd --version
```

В PowerShell с запретом `.ps1` используйте **pnpm.cmd** во всех командах
ниже. Execution policy менять не нужно. Если Corepack отсутствует,
установите точную версию: `npm.cmd install --global pnpm@10.34.9`.

### WSL2 / Linux

В WSL2 используйте Linux Node/pnpm и рабочую копию без Windows node_modules;
Docker CLI должен видеть Docker Desktop engine. На Linux установите
[Docker Engine и Compose plugin](https://docs.docker.com/engine/install/ubuntu/)
для своей поддерживаемой дистрибуции и запустите daemon.
Установите Node 24.22.2 через [официальный архив](https://nodejs.org/dist/v24.22.2/)
или [nvm](https://github.com/nvm-sh/nvm#installing-and-updating).
При уже установленном nvm из корня проекта:

```sh
nvm install
nvm use
node --version
mkdir -p .cache/bin
corepack enable --install-directory .cache/bin pnpm
export PATH="$PWD/.cache/bin:$PATH"
pnpm --version
docker version
docker compose version
```

Если Corepack нет — `npm install --global pnpm@10.34.9` после установки
Node 24.22.2. Инструкции package manager: [pnpm 10](https://pnpm.io/10.x/installation).
Установка Docker/WSL/Node требует действий владельца машины; эти команды не
выдаются за выполненную здесь установку.

## Получение исходников

В текущем рабочем дереве код Foundation есть, но он пока не опубликован.
Проверенный remote HEAD `8058a4e6a61a3b90a906ac2874f1cd9d59b2900c` содержит
только AGENTS.md, README.md и docs — без package.json/CI workflow.
Полное прохождение следующих инструкций из remote clone станет возможно
после review и публикации Foundation. Существующее дерево не заменяйте клоном.

После публикации, для новой рабочей копии:

```sh
git clone https://github.com/sasha761/lifeOS.git lifeos
cd lifeos
pnpm install --frozen-lockfile
```

В существующем дереве после проверки Node/pnpm выполните тот же frozen install.
Зависимости/версии фиксирует pnpm-lock.yaml; `.npmrc` использует ignored
project-local `.pnpm-store`. `.cache`, node_modules, dist и .next не коммитятся.

## Первый локальный запуск

Из корня, **только если .env ещё нет**, один раз выполните:

```sh
pnpm db:env
```

Команда создаёт ignored .env с двумя случайными паролями и никогда не
перезаписывает существующий файл. Если .env уже есть, сохраните его и
сверьте настройки с [.env.example](.env.example). Placeholders шаблона не
являются рабочими credentials. Не публикуйте URL/пароли и NEXT_PUBLIC_* secrets.

```sh
pnpm db:up
pnpm db:migrate
pnpm db:status
pnpm db:test:up
pnpm verify
```

Main DB — 127.0.0.1:15432 / lifeos; test instance — 127.0.0.1:15433 /
lifeos_test. Это отдельные instances/roles/passwords/volumes. Миграции создают
техническую fixture, journal и таблицы Better Auth (`user`, `session`,
`account`, `verification`); verify применяет миграции к явной test DB и не
использует main DATABASE_URL как fallback.
Подробности и безопасная изоляция: [DB README](packages/db/README.md).

### Аккаунт (LFS-201)

`pnpm db:env` для нового `.env` генерирует и `BETTER_AUTH_SECRET`. Если `.env`
создан раньше, добавьте ключи из [.env.example](.env.example): секрет 32+
символов, `BETTER_AUTH_URL`, `MAIL_*`. Регистрация закрыта: впишите свой email в
`AUTH_SIGNUP_ALLOWLIST` (через запятую, регистр не важен) и выполните
`pnpm db:migrate`. Затем откройте `/auth/sign-up`.

Письма восстановления доступа в dev/test не отправляются наружу: с
`MAIL_TRANSPORT=outbox` каждое письмо — JSON-файл в `.cache/dev-mail`
(путь `MAIL_OUTBOX_DIR` считается от `apps/web`), ссылка — в поле `text`.
В production обязателен `MAIL_TRANSPORT=smtp` и `SMTP_URL` реального
провайдера (`smtps://user:password@host:465`); outbox там запрещён валидацией.

### Web

```sh
pnpm dev
```

Откройте http://127.0.0.1:3000:

- `/` — обзор и шесть сфер из кодового реестра без личных данных.
- `/domains/languages`, `/domains/finance`, `/domains/work`, `/domains/projects`, `/domains/skills`, `/domains/health` — страницы сфер: гостю — описание сферы, после входа — цели сферы и последние действия в ней (LFS-213); специализированные модули появятся позже. Неизвестный ключ — 404.
- `/auth/sign-in`, `/auth/sign-up`, `/auth/forgot-password`, `/auth/reset-password` — аккаунт.
- `/dashboard` — «Мой кабинет» после входа: сроки, последние действия и строки шести сфер с прогрессом их новейших целей (LFS-204, LFS-213).
- `/goals`, `/goals/new`, `/goals/:id` — защищённый список, создание и детали;
  ручные измерения, исправление/удаление с подтверждением, metadata и архив.
  От 1024px список и панель выбранной цели рядом, как на макете 09 (LFS-213).
  «Новая цель» открывается диалогом поверх текущей страницы; прямой заход на `/goals/new` — отдельная страница (LFS-212).
- `/settings` — профиль, выход, часовой пояс и язык/формат дат текущего пользователя (LFS-202, LFS-213), только после входа.
- `/telegram` — компактная заглушка Mini App, без linking/SDK.
- `/api/health` — JSON `{ data, meta, errors }`, текущий timestamp и IDs, no-store.
- `/api/v1/me` — текущий пользователь; 401 без сессии.
- `/api/v1/me/preferences` — `GET`/`PATCH` своих `timezone`/`locale`; 401 без сессии, 400 для невалидных значений и `userId` в body.
- `/api/v1/goals` — `GET` списка с прогрессом, `POST` ручной цели; `/api/v1/goals/:goalId` — `GET`/`PATCH` metadata или archive.
- `/api/v1/dashboard` — `GET` read model Dashboard владельца; [DTO](docs/api/contracts.md#dashboard-сфер-lfs-204).
- `/api/v1/activity` — `GET` журнала действий владельца, фильтр `domain_key` или `goal_id`, `limit` до 50; [DTO](docs/api/contracts.md#журнал-действий-lfs-213).
- `/api/v1/goals/:goalId/measurements` — `GET` истории с cursor/limit, `POST` измерения; `/api/v1/goal-measurements/:measurementId` — `PATCH`/`DELETE`. Все записи требуют `Idempotency-Key`; [DTO и примеры](docs/api/contracts.md#http-целей-и-прогресс-lfs-207).

Для локального `MAIL_TRANSPORT=outbox` используйте `pnpm dev`. Команда `start`
запускает production и требует `MAIL_TRANSPORT=smtp` с рабочим `SMTP_URL`.
Несовместимые настройки отклоняются до запуска сервера. Root `.env` загружается
внутри launcher через Node `process.loadEnvFile`, без CLI-флага, который
Next 16.4.5 некорректно переносит в `NODE_OPTIONS` дочернего dev-процесса.

Health — liveness Web; доступность DB/worker он не доказывает.
Для production smoke сначала остановите dev, затем:

```sh
pnpm build
pnpm --filter @lifeos/web start
```

Dev/start используют один default port; одновременно их не запускайте.
Используйте package scripts: они проверяют env до Next CLI. Build не требует
runtime DB/Telegram/AI credentials. [Routing ADR](docs/adr/004-next-routing.md).

### Worker в отдельном терминале

```sh
pnpm worker:build
pnpm worker:start
```

В ещё одном терминале:

```sh
pnpm worker:ping
pnpm worker:ping --fail-once
pnpm worker:ping --always-fail
```

Для dev — `pnpm worker:dev`. Job modes технические; queued log не заменяет
проверку completed/failed и output в PostgreSQL. Ctrl+C/SIGTERM запускают
graceful shutdown; на Windows также Ctrl+Break/SIGBREAK.
[Worker docs](docs/architecture/worker.md) описывают policy, ограничения и тесты.

## Проверки и остановка

`pnpm verify` повторяет CI: frozen install → lint → typecheck → unit
tests → test migrations → PostgreSQL integration tests (DB, Web/Better
Auth, worker) → Web/worker build → production build smoke (включая auth guards). Нужны точный Node/pnpm, Docker/test DB и
TEST_DATABASE_URL. Каждый этап возвращает реальный exit code; Turbo cache
не подменяет проверки. [CI/env/cache](docs/CI.md).

| Команда | Назначение |
|---|---|
| `pnpm lint`, `pnpm typecheck` | Все шесть workspace + root tooling |
| `pnpm test` | Unit suites шести workspace (web, config, contracts, db, domain, worker) |
| `pnpm db:migrate:test` | Только dedicated TEST_DATABASE_URL, без удаления DB |
| `pnpm test:db` | Migration/CLI/atomicity/dedupe/replay на PostgreSQL |
| `pnpm test:web` | Better Auth + PostgreSQL: allowlist, сессии, logout, reset, 401 |
| `pnpm test:worker` | Отдельные worker/CLI, retry и shutdown на PostgreSQL |
| `pnpm test:integration` | DB, Web, затем worker suites |
| `pnpm test:ui` | Сборка + Playwright UI целей в изолированной test schema, desktop/mobile |
| `pnpm ui:shots` | Сборка + скриншоты страниц Stage 2 на 1440/390 и сравнение с макетами в `.cache/ui-shots` ([UI_GUIDELINES §5](docs/UI_GUIDELINES.md)) |
| `pnpm build`, затем `pnpm test:build` | Обе production сборки и smoke |
| `pnpm db:generate` | Offline Drizzle SQL generation без credentials |
| `pnpm db:test:down` | Остановить только test instance |
| `pnpm db:down` | Остановить Compose project/удалить containers/network, сохранив volumes |

Не используйте down -v, удаление database/volume или переписывание применённых
SQL для исправления окружения. Изменение существующей schema — новая миграция.

## Типичные проблемы

| Симптом | Действие |
|---|---|
| Unsupported engine / verify требует другой Node | Сверить node --version с .nvmrc, pnpm --version с packageManager; не отключать engine-strict |
| pnpm не найден / .ps1 blocked | Проверить локальные shims/PATH; в PowerShell использовать pnpm.cmd |
| Docker daemon/pipe недоступен | Запустить Docker Desktop/Engine, проверить docker version и WSL integration |
| Ошибка DATABASE_URL до Ready | Настроить root .env по .env.example; startup validation намеренно ранняя |
| Integration требует TEST_DATABASE_URL | Запустить db:test:up и задать отдельный test URL; main URL не является fallback |
| Порт занят | Менять PORT и соответствующий URL вместе в .env; по умолчанию 15432/15433 |
| Изменён .env, но пароль PG не изменился | POSTGRES_PASSWORD применяется при первой инициализации volume; сохранить исходный .env, не удалять данные ради сброса |
| Workspace import/dist отсутствует | Запускать root dev/build/verify или worker:build, которые собирают dependencies |

## Handoff и следующий этап

Работать по одному [LFS task](docs/tasks/README.md), начиная с AGENTS.md и
git status. Сначала контракт/типы → реализация → тесты → docs. Правила
веток/commits/PR и ADR: [development workflow](docs/DEVELOPMENT_WORKFLOW.md).
Прежние незакоммиченные изменения не удаляются и не смешиваются с новым scope.

Stage 2 выполняется по [STAGE-02-README](docs/tasks/STAGE-02-README.md): аккаунты,
preferences/ownership, реестр сфер, ручные цели, измерения и аудит реализованы.
API, прогресс, UI целей и Dashboard сфер реализованы; следующая задача — LFS-209 (E2E, security, приёмка).
При обновлении другой локальной копии примените `pnpm db:migrate`
(актуальная миграция `0005_goal_measurements`). Dashboard показывает только
реальные цели и измерения; фиктивного общего процента жизни нет. Каждый
следующий LFS-ID начинается только после решения пользователя.
Текущие PASS/NOT RUN и необходимые ручные действия —
[список задач](docs/tasks/README.md) и отчёты соответствующих LFS-ID.
