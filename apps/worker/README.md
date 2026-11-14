# @lifeos/worker

Отдельный Node.js 24.22.2 процесс, pg-boss 12.38.1 и PostgreSQL из LFS-104.
Единственная очередь LFS-105 — техническая `demo.ping`. Web и worker
не импортируют друг друга и запускаются независимо.

## Запуск из корня

```sh
pnpm db:up
pnpm worker:build
pnpm worker:start
```

В другом терминале:

```sh
pnpm worker:ping
pnpm worker:ping --fail-once
pnpm worker:ping --always-fail
```

Для разработки `pnpm worker:dev` предварительно собирает DB dependency
через Turborepo и запускает Node `--watch`. Production `worker:start`
запускает `dist/index.js` после `worker:build` или корневого `build`.
На PowerShell при запрете `.ps1` используйте `pnpm.cmd`.

Root `.env` загружается Node `--env-file-if-exists`; настоящие переменные
среды имеют приоритет. Нужен серверный `DATABASE_URL`, совпадающий с
application DB LFS-104. Не используйте `NEXT_PUBLIC_` для DB URL.
`WORKER_QUEUE_SCHEMA` необязателен (default `pgboss`), проверяется отдельно:
1–50 lowercase ASCII letters/digits/underscore, первый символ — буква;
системные, public и Drizzle schemas запрещены. В LFS-106 schema и DATABASE_URL
проверяются общим `@lifeos/config/env` до создания runtime. Ошибка startup
содержит `invalid_settings` с именами полей, без исходных значений.
Локальный `.env` не перезаписывается.

pg-boss владеет отдельным pool на том же драйвере `pg` 8.23.1, max 5 и
connection timeout 5 секунд. Startup создаёт/мигрирует свои технические
объекты внутри queue schema средствами pg-boss. Эти объекты не входят
в Drizzle application migrations. Роль локальной БД должна иметь право
создания schema; управление production-ролями выходит за LFS-105.

## Demo и обработка ошибок

CLI допускает только три фиксированных режима выше. Он генерирует один UUID
для request/correlation ID и отправляет `{ requestId, correlationId, mode }`; неизвестные аргументы
завершаются кодом 1 до соединения с БД. Публичного HTTP producer нет.
Payload повторно валидируется worker как неизвестный вход, лишние поля
отклоняются общей схемой `@lifeos/contracts`. `createDemoPayload(mode, context)`
переносит существующий HTTP context без генерации новых ID. Старые jobs без
requestId остаются валидными. [Общий контракт](../../docs/api/contracts.md).

Worker логирует JSON с `event`, `status`, `job_id`, `request_id`, `correlation_id`, `attempt`
и безопасным `code` при ошибке. SQL, URL, исходные exception messages и
payload в логи не попадают. `processed` означает успешное завершение
handler; pg-boss затем сохраняет `completed` и output
`{ request_id?, correlation_id, status: "pong" }` в PostgreSQL. CLI `queued` подтверждает
постановку; окончательный результат подтверждает integration suite.

Ограничение: 2 retries, то есть максимум 3 попытки; delay 1 секунда,
exponential backoff с jitter, maximum delay 10 секунд. Polling — 1 секунда,
expiration активной попытки — 30 секунд. Queue defaults обновляются при
старте, producer также явно передаёт политику для новых jobs. Уже записанные
jobs сохраняют свою политику. `--fail-once` доказывает восстановление;
`--always-fail` заканчивается `failed`, без бесконечных повторов.
Jobs хранятся максимум сутки после завершения; retention ожидающих — сутки.

SIGINT/SIGTERM запускают одну процедуру остановки: прекращение fetch,
ожидание активных handlers до 10 секунд, затем settlement/abort оставшихся
jobs средствами pg-boss и закрытие pool. Timeout ограничивает ожидание
handler; cleanup БД может занять дополнительное время. Повторный сигнал
во время shutdown не начинает вторую остановку. `process.exit()` не
обрывает запросы. Неожиданный startup/shutdown failure даёт exit code 1;
ошибки отдельных jobs передаются pg-boss для ограниченных retries.
На Windows дополнительно поддерживается SIGBREAK (Ctrl+Break) через ту же
процедуру; это полезно для консолей с отключённой доставкой Ctrl+C.

## Проверки

```sh
pnpm --filter @lifeos/worker typecheck
pnpm --filter @lifeos/worker test
pnpm db:test:up
pnpm test:worker
```

Root lint/typecheck/test/build включают worker. Root `dev` выбирает только
Web и его DB dependency; `worker:dev` выбирает только worker.

Unit suite проверяет конфигурацию, payload, безопасные логи и demo modes.
Integration suite использует обязательный `TEST_DATABASE_URL` и защиту
test target из DB package. Она атомарно резервирует случайную schema
`lfs105_queue_<uuid>`, запускает отдельные Node worker/CLI процессы,
ожидает observable conditions с deadline, подтверждает PostgreSQL output,
повторы до terminal failed и shutdown активного handler. Проверяется
отсутствие worker sessions в `pg_stat_activity` после остановки.

На Windows `child.kill(SIGTERM)` завершает процесс принудительно.
Только test fixture передаёт сигнал по IPC в зарегистрированный Node
SIGINT/SIGTERM listener; на POSIX тест отправляет настоящий OS signal.
Production entrypoint и producer не содержат IPC-команд. Test gate активной
job также существует только в fixture. После suite официальный uninstall
удаляет только pg-boss objects в schema текущего запуска, затем DROP SCHEMA
RESTRICT. Application DB, чужие schemas и volumes не удаляются.

Redis, AI/Telegram calls, business jobs и notification schedules отсутствуют.
pg-boss internal supervision включён для worker, scheduler выключен.
Atomic write+enqueue и idempotency proof реализованы в test-only LFS-107 fixture;
production demo handler не является готовым бизнес-consumer.
Версии и проверенный API: [ADR-001](../../docs/adr/001-stack.md),
[ADR-002](../../docs/adr/002-postgres-queue.md).

## Результаты LFS-105

2026-11-10, Windows x64 / Node 24.22.2 / pnpm 10.34.9 / PostgreSQL 18.6:
22 worker unit-теста и 5 integration-тестов прошли. Последние проверяют
CLI completion/output, recovery и terminal failure, drain активной job,
отказ при неверном URL и недоступной БД. DB migration regression smoke
также прошёл; root test — 37 unit-тестов, lint/typecheck/build успешны.

Обычные worker:start и worker:ping проверены на основной БД во всех трёх
режимах. Web отдельно ответил HTTP 200, worker sessions при этом — 0;
dry graph корневого dev содержит только Web и его DB/config dependencies.
Production worker дополнительно прошёл native Windows Ctrl+Break shutdown.
Ctrl+C в инструментальной консоли не доставлялся, поэтому первоначальный
idle smoke-процесс после terminal jobs был принудительно завершён;
SIGINT/SIGTERM callbacks проверены через описанную test fixture.
POSIX-доставка сигналов в этом окружении не запускалась.

После проверок worker/Web smoke-процессы остановлены, worker connections
и временные queue schemas отсутствуют. Три demo jobs сохранены в основной
queue schema для просмотра до истечения retention. Пользовательские
таблицы, исходники Web, application migrations и Master Plan не изменялись.

## Handoff LFS-109

Текущий lifecycle, гарантия fixture и её отличие от production handler:
[architecture/worker](../../docs/architecture/worker.md).
Полная verify chain повторно прошла: 94 unit и 18 PostgreSQL tests, builds и
smoke. Linux/POSIX suite проходила в изолированной Linux-копии LFS-108;
абзацы «Результаты LFS-105» выше сохраняют историческое окружение/дату.
Текущие PASS/NOT RUN: [Stage 1 acceptance](../../docs/tasks/STAGE-01-ACCEPTANCE.md).
