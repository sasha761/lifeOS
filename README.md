# LifeOS · Stage 1 Foundation

LifeOS — модульная платформа целей и развития в сферах Languages, Finance,
Work, Projects, Skills и Health. Языковой учитель — будущий модуль платформы.
Сейчас реализован технический Foundation: Web shell, PostgreSQL/Drizzle,
отдельный demo-worker pg-boss, контракты/env, atomicity tests и CI workflow.
Auth, цели, реальные измерения прогресса, Telegram SDK и AI ещё не реализованы.

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
| `packages/domain` | @lifeos/domain | Пустой framework-independent модуль с lint/typecheck |
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
lifeos_test. Это отдельные instances/roles/passwords/volumes. Миграции пока
создают только техническую fixture и journal; verify применяет миграции к
явной test DB и не использует main DATABASE_URL как fallback.
Подробности и безопасная изоляция: [DB README](packages/db/README.md).

### Web

```sh
pnpm dev
```

Откройте http://127.0.0.1:3000:

- `/` — shell и шесть будущих сфер без личных данных.
- `/telegram` — компактная заглушка Mini App, без linking/SDK.
- `/api/health` — JSON `{ data, meta, errors }`, текущий timestamp и IDs, no-store.

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

`pnpm verify` повторяет CI: frozen install → lint → typecheck → 94 unit
tests → test migrations → 18 PostgreSQL integration tests → Web/worker
build → production build smoke. Нужны точный Node/pnpm, Docker/test DB и
TEST_DATABASE_URL. Каждый этап возвращает реальный exit code; Turbo cache
не подменяет проверки. [CI/env/cache](docs/CI.md).

| Команда | Назначение |
|---|---|
| `pnpm lint`, `pnpm typecheck` | Все шесть workspace + root tooling |
| `pnpm test` | Реальные unit suites пяти workspace; domain business code ещё нет |
| `pnpm db:migrate:test` | Только dedicated TEST_DATABASE_URL, без удаления DB |
| `pnpm test:db` | Migration/CLI/atomicity/dedupe/replay на PostgreSQL |
| `pnpm test:worker` | Отдельные worker/CLI, retry и shutdown на PostgreSQL |
| `pnpm test:integration` | DB, затем worker suites |
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

Stage 2 по Master Plan — Better Auth, ownership, реестр сфер, Dashboard,
goals/goal_measurements/activity_events и ручной прогресс. Эти функции не
реализованы; нет фиктивного общего процента жизни. Для следующего LFS-ID
нужна отдельная постановка и решение пользователя после приёмки Foundation.
Текущие PASS/NOT RUN и необходимые ручные действия —
[Stage 1 acceptance](docs/tasks/STAGE-01-ACCEPTANCE.md).
