# Проверки и GitHub Actions · LFS-108

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
Триггеры: каждый pull request, push в `main`, ручной `workflow_dispatch`.
Deploy/CD, бизнес-E2E и AI-evals в эту задачу не входят.

## Одна цепочка локально и в CI

Используются Node **24.22.2** из `.nvmrc`, pnpm **10.34.9** из
`package.json#packageManager`, PostgreSQL **18.6-bookworm** с тем же immutable
digest, что и в локальном Compose. `scripts/verify.ts` проверяет точную Node
версию и запускает pnpm CLI через неё без shell interpolation.

Для локального запуска с уже настроенным root `.env`:

```sh
pnpm db:test:up
pnpm verify
```

Если `.env` ещё нет, один раз создайте его через `pnpm db:env`; существующий
файл не перезаписывается. В PowerShell при запрете `.ps1` используйте
`pnpm.cmd`. Docker должен быть запущен. `verify` не запускает и не удаляет БД.
Можно вместо `.env` передать `TEST_DATABASE_URL` через environment.

| Этап verify | Реальная команда |
|---|---|
| Воспроизводимая установка | `pnpm install --frozen-lockfile` |
| Lint | `pnpm lint` — шесть workspace и root tooling |
| Types | `pnpm typecheck` — шесть workspace и root tooling |
| Unit | `pnpm test --force` — пять workspace с реальными suites |
| Test migrations | `pnpm db:migrate:test` |
| PostgreSQL integration | `pnpm test:integration` — DB, затем worker |
| Production builds | `pnpm build` — Web, worker и пакетные dependencies |
| Build smoke | `pnpm test:build` |

`CI=true` делает frozen install неинтерактивным. `verify` задаёт `TURBO_FORCE=true`,
поэтому cache не подменяет lint/types/tests/build локально или в CI. Каждый
этап ждёт завершения предыдущего и прекращает цепочку при ненулевом exit code,
возвращая этот код. Заглушки и подавление ошибок не используются.

`domain` пока не содержит бизнес-правил, но проходит настоящие ESLint/tsc.
Фиктивные build/test команды из него удалены. Unit-контракты проверяются в
`packages/contracts`; доменная логика ради CI не добавлялась.

## Test DB и миграции

GitHub job использует Ubuntu 24.04 и отдельный PostgreSQL service с БД
`lifeos_test_ci`. Временный service содержит только synthetic fixtures;
`POSTGRES_HOST_AUTH_METHOD=trust` позволяет обходиться без пароля и repository
secrets внутри одноразового runner. Динамический host port берётся из
`job.services.postgres.ports['5432']` в environment шага verify.
Такую auth-настройку не следует переносить в локальную или production БД.

В workflow отсутствует `DATABASE_URL`. `db:migrate:test` использует только
`TEST_DATABASE_URL` и существующую защиту `readTestDatabaseUrl`: имя test DB
обязательно, application target и совпадение с DATABASE_URL отклоняются.
Проверка происходит до создания pool. Команда повторяемо применяет официальный
Drizzle migrator к test DB; public fixture и migration journal сохраняются
для повторного запуска. Она не выполняет DROP DATABASE/volume/schema.

Integration suites дополнительно создают свои случайные namespaces для
migration/atomicity/worker tests и удаляют только принадлежащие им объекты с
RESTRICT. Новая проверка `test-migrations-cli.test.ts` запускает реальный CLI
дважды и проверяет fixture/journal через SQL. Она не зависит от выполнения
предыдущего migration шага или других тестов.

## Build smoke и секреты

Перед build и smoke `verify` убирает DATABASE_URL, TEST_DATABASE_URL,
WORKER_QUEUE_SCHEMA и переменные с префиксами Telegram/AI/OpenAI/Anthropic.
Web/worker build не требуют production credentials. Smoke не загружает `.env`.

`scripts/build-smoke.ts` проверяет artifacts, запускает production Web на
свободном loopback port, запрашивает `/`, `/telegram`, `/api/health` и валидирует
общий health-контракт, ID и no-store headers. Web получает synthetic URL к
недоступному порту, поэтому health не требует DB connection.

Затем smoke запускает compiled worker entrypoint с намеренно неверным env:
требуется ожидаемая безопасная startup-ошибка и exit 1, не ошибка загрузки ESM.
Успешную работу worker с PostgreSQL, retries и shutdown проверяет integration
suite. Все дочерние smoke-процессы завершаются в finally; captured output и
upstream exception details не печатаются при ошибке.

## Actions и cache

Actions закреплены полными commit SHA: checkout **6.1.0**, setup-node **6.5.0**,
pnpm/action-setup **6.1.1**. `setup-node` кеширует только pnpm store по
`pnpm-lock.yaml`. `node_modules`, `.next` и `.turbo` не восстанавливаются как
замена проверкам. Workflow использует `contents: read`, checkout без сохранения
credentials, отменяет устаревший запуск того же ref и имеет timeout 20 минут.

Метаданные и refs сверены с официальными
[checkout](https://github.com/actions/checkout),
[setup-node](https://github.com/actions/setup-node),
[pnpm/action-setup](https://github.com/pnpm/action-setup).
Service container устроен по
[GitHub PostgreSQL service docs](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers).
YAML локально проверяется actionlint; фактический запуск на GitHub следует
отличать от локального Linux rehearsal.

## Публикация

Remote указывает на `sasha761/lifeOS`, доступ к metadata подтверждён. Новый
workflow пока находится в рабочем дереве вместе с незакоммиченными предыдущими
этапами. Для запуска именно этого YAML нужно опубликовать проверенное состояние
репозитория обычным commit/push или pull request. Эта задача не публикует
предыдущие этапы автоматически. До реального выполнения GitHub run status/URL
не выдаётся за успешную проверку.
