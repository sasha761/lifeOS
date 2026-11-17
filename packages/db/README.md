# @lifeos/db

PostgreSQL infrastructure на `pg` 8.23.1 и Drizzle ORM 0.45.4 / Kit 0.31.11.
Драйвер совместим с pg-boss adapter, проверенным в fixture LFS-107; решение —
[ADR-002](../../docs/adr/002-postgres-queue.md). Пакет не зависит от Next.js.

В LFS-106 URL validation делегирована общему Zod-parser `@lifeos/config/env`;
существующий API ошибок DB и защита test target сохранены. Root `db:migrate`,
`db:status`, `test:db` сначала собирают dependencies; с LFS-205 contracts
используется схемой и repository в runtime. Для прямого запуска workspace
DB CLI сначала соберите `@lifeos/config` и `@lifeos/contracts`; корневые
DB-команды делают это автоматически, `db:generate` собирает contracts.

## Локальное окружение

На Node.js 24.22.2 / pnpm 10.34.9 из корня репозитория:

```sh
pnpm db:env
pnpm db:up
pnpm db:status
pnpm db:migrate
pnpm db:migrate
pnpm db:status
```

На PowerShell при запрете `.ps1` используйте `pnpm.cmd`.
`db:env` атомарно создаёт игнорируемый root `.env` с двумя независимыми
случайными паролями. Существующий `.env` не перезаписывается. В
`.env.example` только пустые password-поля и URL с placeholders.
Пароли и connection strings не выводятся CLI.

Compose-файл: `infra/docker/compose.yaml`, project `lifeos-foundation`.
Образ PostgreSQL 18.6-bookworm закреплён tag + manifest digest в Compose и
ADR. Main instance: `127.0.0.1:15432`, DB/user `lifeos`. Test profile:
`127.0.0.1:15433`, DB/user `lifeos_test`. Для обоих настроены healthcheck и
отдельные persistent volumes. Публикуется только loopback-интерфейс.

Порты 55432/55433 оказались в зарезервированном диапазоне Windows, поэтому
выбраны 15432/15433. При смене портов измените соответствующие PORT и URL
в `.env` вместе. Volumes PostgreSQL 18 монтируются в `/var/lib/postgresql`;
фактический default PGDATA — `/var/lib/postgresql/18/docker`.

```sh
pnpm db:down
pnpm db:up
```

`db:down` останавливает оба сервиса и удаляет их контейнеры/сеть, сохраняя
оба volumes. Флаг `-v` не используется. Повторный `db:up` сохраняет
миграции и данные. Сохраните локальный `.env`: POSTGRES_PASSWORD применяется
при инициализации пустого volume; редактирование `.env` не меняет пароль
уже созданной роли PostgreSQL.

## API и lifecycle

Публичный ESM export — `dist/index.js`, типы — `dist/index.d.ts`.
`pnpm --filter @lifeos/db build` компилирует strict TypeScript и declarations.
Web и worker объявляют `workspace:*` dependency; Turborepo строит DB перед
Web dev/build/typecheck. Web использует БД для сессии и preferences.

LFS-205 добавила `schema.goals`, `createGoalsRepository(databaseOrTransaction)`
и `0003_goals.sql`: точный numeric в строковом режиме, CHECK значений/режима,
FK владельца и индексы с user_id. Каждая выборка/мутация проходит `ownedBy`;
metadata обновляется только для active, архив повторяем без смены timestamp.
Сервис и политики — [ADR-007](../../docs/adr/007-goals.md). Audit присоединён
в LFS-210, публичный HTTP adapter — в LFS-207.

`createGoalsUnitOfWork(db)` — обязательный persistence adapter для
`createGoalsService`. Он выполняет goal mutation + activity event + command
receipt в одной Drizzle transaction. Writer доступен как
`createActivityEventWriter(transaction, actor, options)` и принимает тип
`LifeosTransaction`, не root client. Обычный goals repository — низкоуровневый
SQL adapter, не самостоятельный application write entrypoint.

`createActivityEventsRepository` читает только события actor; список по цели
ограничен 100 записями. Compound FK проверяют владельца и domain родительской
цели. Advisory key lock и row lock защищают duplicate/replay и before/after;
для no-op создаётся только receipt. Миграция `0004_activity_events.sql`
не создаёт фиктивных исторических событий. Схема, scope ключа и семантика
replay актуального ресурса — [ADR-008](../../docs/adr/008-transactional-audit.md).

`createGoalMeasurementsUnitOfWork(db)` (LFS-206) связывает measurement CRUD,
аудит и ту же таблицу receipts в одной транзакции. Parent lock предшествует
child lock и согласован с archive цели. `createGoalMeasurementsRepository`
фильтрует owner, возвращает current/history по measured_at/created_at/id DESC
(history до 100). Низкоуровневый repository не является application write API.
`0005_goal_measurements.sql` добавляет owned/unit FK, точные CHECK и расширяет
receipts для replay DELETE после удаления child без потери ключа.
Совместимость старых квитанций и семантика — [ADR-009](../../docs/adr/009-goal-measurements.md).

`createGoalsReadRepository(db)` (LFS-207): owned detail/list/history в READ ONLY
REPEATABLE READ, согласованные goal/count/latest/audit time. Goal list использует
пакетные SELECT, а не N+1; history поддерживает полный tuple cursor и limit+1.
Count включает все существующие замеры, не только страницу. Domain собирает
progress, SQL не вычисляет проценты. Нового DDL/migration нет;
[ADR-010](../../docs/adr/010-goals-api-progress.md).

```ts
import { createDatabase } from "@lifeos/db";

const client = createDatabase({ connectionString: process.env.DATABASE_URL ?? "" });
try {
  await client.pool.query("SELECT 1");
} finally {
  await client.close();
}
```

Импорт пакета не читает env и не создаёт подключений. Фабрика создаёт lazy
pool (max 5, connection timeout 5 секунд) и typed Drizzle client.
Композиция приложения владеет одним client на runtime и закрывает его при
остановке. `onIdleError` позволяет обработать idle-pool ошибку без передачи
сырого сообщения; ошибки query отклоняют Promise. Пакет не логирует SQL,
пароли или connection strings.

DB CLI использует root `.env` через Node `--env-file-if-exists`; переменные
среды имеют приоритет, что позволяет передать `DATABASE_URL` из CI/secrets.
Web dev/start и worker загружают ту же root `.env` средствами Node через
workspace scripts; переменные процесса имеют приоритет. Сам Next.js из
`apps/web` не ищет root `.env`, поэтому используйте эти scripts, а не прямой
Next CLI. Значение `DATABASE_URL` никогда не должно иметь префикс
`NEXT_PUBLIC_`. В будущем Docker runtime
hostname будет `postgres`, port 5432; текущие host-процессы используют
127.0.0.1:15432. Health endpoint Web остаётся независимым от БД.

DB-specific URL validation проверяет неизвестный конфиг и печатает только
безопасные сообщения/коды. Общая env-schema реализована в `@lifeos/config/env`;
контракт и startup rules описаны в [API docs](../../docs/api/contracts.md).
`skipLibCheck` локально исключает сторонние `.d.ts` Drizzle с optional
Gel/MySQL/SQLite adapters и несовместимыми declarations из проверки;
strict исходников, schema payload types и tests сохраняется. Эти адаптеры
не устанавливаются. Общий tsconfig остальных пакетов не изменён.

## Schema и миграции

- `src/schema/` — TypeScript schema: техническая `foundation_migration_fixture`
  и core-таблицы Better Auth (`auth.ts`: `user`, `session`, `account`,
  `verification`; LFS-201, [ADR-005](../../docs/adr/005-auth.md)).
- `drizzle.config.ts` — offline generation config без credentials.
- `drizzle/` — сгенерированные SQL, snapshots и journal, хранящиеся в Git.
- `applyMigrations` — официальный node-postgres migrator из отдельного entry
  `@lifeos/db/migrations` (основной `@lifeos/db` — client/schema для runtime и
  Next.js bundle); история по умолчанию хранится в `drizzle.__drizzle_migrations`.

```sh
pnpm db:generate
pnpm db:migrate
```

Generate не подключается к БД и при неизменной schema не создаёт новый SQL.
Migrate применяется к `DATABASE_URL` и безопасно повторяется. Уже
применённые SQL не редактируются. Когда fixture перестанет быть нужна,
удаление её schema declaration и отдельная новая SQL-миграция будут
выполнены в соответствующей будущей задаче. `0001_better_auth.sql` создаёт таблицы
Better Auth; FK в нём намеренно без `public.` (разрешаются через search_path,
чтобы test schemas были изолированы). Goals, audit и measurements добавлены
отдельными миграциями 0003–0005.

**LFS-202.** `0002_user_preferences.sql` добавляет `user.timezone` (DEFAULT `UTC`) и
`user.locale` (DEFAULT `ru`) с CHECK по длине; Better Auth эти колонки не знает.
Стратегия: миграция только расширяет схему и совместима с кодом LFS-201, поэтому
откат приложения не требует отката схемы; удаление колонок — только новой
forward-миграцией через `pnpm db:generate`, применённые SQL/journal не правятся.
Ownership для repositories — `ownedBy(table.userId, actor, …)` из `src/ownership.ts`
(`user_id = actor.userId AND …`); первый repository —
`createUserPreferencesRepository` (`src/repositories`). Порт и branded `Actor` —
из `@lifeos/domain` (зависимость только по типам). Правило —
[ADR-006](../../docs/adr/006-actor-ownership.md). Очередь production worker создаётся отдельно;
fixture LFS-107 использует собственную disposable schema, описанную ниже.

## Тесты

```sh
pnpm test
pnpm db:test:up
pnpm test:db
pnpm db:test:down
```

Root `test` запускает 17 DB unit-тестов без PostgreSQL: валидация URL,
отказ от application DB как test target, безопасные ошибки, lazy pool и
защита test migration CLI. Root `test:db` запускает реальные migration/CLI/
atomicity suites через Vitest, без mock/PGlite.
`TEST_DATABASE_URL` обязателен: отсутствующая конфигурация или недоступный
сервер приводят к FAIL, не к skip. Имя целевой DB должно быть `lifeos_test`
или `lifeos_test_*`, target должен отличаться от `DATABASE_URL`.

Тест атомарно создаёт новый namespace `lfs104_migration_<uuid>` в отдельной
тестовой БД, задаёт `search_path` и migration-history schema, применяет
реальный SQL, пишет/читает fixture, повторяет миграцию и проверяет одну
запись journal и сохранность fixture. Cleanup касается только двух
известных таблиц и namespace, созданного текущим запуском; DROP RESTRICT
защищает неожиданные зависимости. БД, volumes и application schema не
удаляются. Ручных SQL-команд для подготовки чистого namespace не нужно.

Для CI подготовьте PostgreSQL и отдельную test DB, передайте URL через
environment и запустите `pnpm test:db`. Пользовательские URLs не используются
как fallback. Worker demo-job — LFS-105; доказательство atomic write + enqueue
и идемпотентности добавлено в LFS-107.

## Atomicity fixture LFS-107

`tests/fixtures/atomicity.sql` и `atomic-operations.ts` существуют только для
integration suite. В `src/schema`, `dist` и application migrations новая
`foundation_test_operations` не добавлена. PgBoss/Zod/contracts подключены как
devDependencies существующих закреплённых версий. Пакет не импортирует apps.

`pnpm test:db` собирает DB и dependencies, затем запускает 13 реальных
PostgreSQL-проверок: migration smoke, test migration CLI и 11 atomicity/idempotency cases.
`pnpm test:integration` дополнительно запускает прежние worker tests.
Commit/rollback проверяются по SQL/queue state; concurrency использует две
одновременно открытые транзакции и barrier без случайных задержек.

Producer защищён UNIQUE idempotency_key; тестовый consumer — row lock и
durable marker вместе с SQL-эффектом. Внешние эффекты и будущие бизнес-операции
этим не покрываются. Изоляция, cleanup и ограничения:
[ADR queue atomicity](../../docs/adr/002-queue-atomicity.md).

## Миграции test DB и CI · LFS-108

`pnpm db:migrate:test` применяет текущие application migrations к явно заданной
test DB. Команда не делает fallback на DATABASE_URL и до создания pool проверяет
`readTestDatabaseUrl`; SQL/credentials в ошибки не включаются. Default public
fixture и Drizzle journal сохраняются для повторного запуска, удаления БД нет.

CLI имеет две негативные unit-проверки (нет TEST_DATABASE_URL / application target)
и PostgreSQL integration test: два запуска, одна запись journal и существующая
fixture. В CI команда вызывается общей цепочкой `pnpm verify` до integration suites.
Описание изолированного service и локального запуска: [CI](../../docs/CI.md).

## Результаты LFS-104

В текущем Windows x64 окружении с Node 24.22.2 / pnpm 10.34.9 / Docker 28.1.1
проверены Compose config, healthcheck обоих экземпляров и PostgreSQL 18.6.
Основная БД была пустой до первого migrate; повторный migrate успешен.
После db:down/db:up оба volumes сохранились, fixture и journal доступны.
Проверены 15 unit-тестов, один integration smoke, стабильный повторный
generate и импорт собранного пакета из Web/worker. Временные test schemas
после smoke отсутствуют. Основной сервер оставлен работающим; test instance
остановлен при проверке down/up, его volume сохранён.

Root lint/typecheck/test/build и проверка корневых TypeScript helper scripts
прошли. Исходные версии Drizzle/pg и архитектурные границы сохранены.
