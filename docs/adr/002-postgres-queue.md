# ADR-002 — PostgreSQL и pg-boss для фоновых задач

- **Статус:** Accepted
- **Дата:** 2026-11-08
- **Связанные задачи:** LFS-102; реализация в LFS-104, LFS-105, LFS-107

## Контекст

Нужны фоновые задания и возможность атомарно сохранить доменную запись и
enqueue. Master Plan требует PostgreSQL, Drizzle и pg-boss без Redis.
Версии и ссылки зафиксированы в [ADR-001](001-stack.md).

## Решение

Выбираем PostgreSQL **18.6**, Drizzle ORM **0.45.4**, Drizzle Kit **0.31.11**,
`pg` **8.23.1** и pg-boss **12.38.1**. И данные приложения, и очередь будут
в одной PostgreSQL; роли и схемы уточняются при реализации инфраструктуры.
Drizzle использует `node-postgres`; pg-boss также зависит от совместимого
`pg ^8.23.1`. Node.js 24.22.2 удовлетворяет требованию pg-boss >=22.12.0,
PostgreSQL 18.6 — требованию >=13.

Официальный [Drizzle transaction adapter](https://pgboss.io/api/adapters)
принимает объект транзакции и `sql` из `drizzle-orm`; `node-postgres`
поддерживается. Для будущего atomic write + enqueue обе операции должны
использовать одну транзакцию через этот adapter. Два независимых pool/query
не доказывают атомарность. Проверка rollback и идемпотентности — LFS-107.

## Альтернативы

Redis/BullMQ требует дополнительного хранилища и отдельного решения для
согласованности SQL и очереди. Он исключён технологическим контрактом.
Другие PostgreSQL drivers возможны upstream, но сейчас выбирается один
общий driver для Drizzle и pg-boss, чтобы сократить матрицу совместимости.

## Последствия

Очередь работает отдельным процессом worker, использует PostgreSQL и
разделяет с ней ограничения доступности и нагрузки. Нужны retry-safe jobs,
явные retry limits и graceful shutdown в LFS-105. Подключение БД, Compose,
миграции и создание схемы pg-boss в LFS-102 не выполняются.

## Проверка

Сверены официальные [drivers Drizzle](https://orm.drizzle.team/docs/get-started-postgresql),
[требования pg-boss](https://pgboss.io/) и adapter docs на 2026-11-08.
Установка проверяет engines/peers; реальная PostgreSQL-транзакция здесь
ещё не проверена и не считается доказанной.

## Реализация LFS-104

`packages/db` использует `pg.Pool` и `drizzle({ client: pool, schema })` из
закреплённого Drizzle 0.45.4. Runtime создаётся явным вызовом фабрики;
владелец закрывает pool. Модульный импорт безопасен без DATABASE_URL и без
сервера, подтверждён импортами из Web и worker. Idle-error callback не
получает сырые сообщения, CLI выводит безопасные ошибки без credentials.

`infra/docker/compose.yaml` содержит основной PostgreSQL и профиль `test`
с отдельными instance, DB, role, password, port и persistent volume.
Оба используют официальный образ 18.6-bookworm с digest из ADR-001,
healthcheck и loopback ports 15432/15433. Порты 55432/55433 входят в
зарезервированный диапазон Windows текущего окружения, поэтому заменены.
Ресурсы других Compose-проектов не изменяются.

Локальные пароли создаются через `db:env` в игнорируемом `.env`; шаблон
содержит placeholders. `db:down` не удаляет volumes. Mount соответствует
новому PGDATA layout PostgreSQL 18. Проверка down/up подтвердила сохранность
обоих volumes, fixture и migration history.

Schema сейчас содержит только `foundation_migration_fixture`. Генерация
SQL и snapshots выполняется Drizzle Kit; application migrations применяет
официальный `drizzle-orm/node-postgres/migrator`, история —
`drizzle.__drizzle_migrations`. Fixture позже удаляется новой отдельной
миграцией, без переписывания применённой истории.

Integration smoke требует отдельный TEST_DATABASE_URL в `lifeos_test` или
`lifeos_test_*` и отклоняет application target. Каждый запуск создаёт
новую случайную схему и направляет в неё search_path и migration history.
Тест проверяет чистый namespace, миграцию, fixture write/read и повторное
применение с одной записью journal. Cleanup ограничен известными объектами
этого запуска и использует RESTRICT; database/volume не удаляются.

На Windows x64 с Docker 28.1.1 / Compose v2.35.1-desktop.1 фактически
проверены оба healthcheck, PostgreSQL 18.6, первая миграция чистой основной
БД, повторный migrate и integration smoke на отдельном test instance.
15 unit-тестов проверяют конфигурацию, защиту test target, redaction и lazy
pool. Ни очередь pg-boss, ни совместная транзакция с enqueue пока не
создавались: соответствующее доказательство остаётся LFS-107.

## Реализация LFS-105

2026-11-10 API сверен с официальной документацией **12.38.1** и declarations
установленного пакета: [constructor](https://pgboss.io/api/constructor),
[operations](https://pgboss.io/api/ops), [queues](https://pgboss.io/api/queues),
[workers](https://pgboss.io/api/workers), [jobs](https://pgboss.io/api/jobs).
Версии pg-boss/pg не изменены. PgBoss владеет отдельным pool max 5 с
connection timeout 5 секунд в той же application PostgreSQL; это не
доказательство совместной Drizzle-транзакции.

Worker и CLI запускаются отдельными Node процессами. `start()` средствами
pg-boss устанавливает/обновляет техническую schema (default `pgboss`),
`createQueue`/`updateQueue` задают defaults, `send` явно фиксирует политику
job, `work` получает batch из одной job. Возвращаемый handler result
сохраняется как output после auto-completion. Состояние проверяется через
`findJobs`; deprecated `getJobById` не используется.

Demo ограничен `demo.ping`, UUID correlation ID и тремя фиксированными
режимами. Две повторные попытки, backoff/jitter с delay 1s / max 10s,
poll 1s и expiration 30s исключают бесконечный tight loop. SIGINT/SIGTERM
запускают `stop({ graceful: true, close: true, timeout: 10000 })` один раз.
pg-boss ждёт/settles active jobs и закрывает принадлежащий ему pool;
таймаут handler не является жёстким deadline всего DB cleanup.

Worker наследует локальный `skipLibCheck` DB consumer из-за сторонних
Drizzle `.d.ts`, описанных в ADR-001; strict исходников сохранён.
Внутренний scheduler выключен, supervision включён. Нет бизнес-расписаний,
внешних API и публичного producer. Логи ограничены техническими полями и
статическими кодами ошибок, upstream errors/payload не печатаются.

Integration suite использует отдельную test DB и резервирует новую
`lfs105_queue_<uuid>` schema без IF NOT EXISTS. Cleanup ограничен objects
этого запуска через официальный `getUninstallPlans` и DROP SCHEMA RESTRICT.
Windows fixture доставляет сигналы по IPC в Node listener, поскольку
Windows kill(SIGTERM) принудителен; POSIX использует OS signals. В production
runtime тестового IPC или искусственного handler gate нет. Atomic
write+enqueue и идемпотентность остаются LFS-107.

Проверка LFS-105 на Windows: 22 worker unit-теста, 5 PostgreSQL integration
tests и root lint/typecheck/test/build прошли. CLI modes завершились
completed (1/2 attempts) и failed (3 attempts). SIGINT/SIGTERM listeners
проверены в fixture; production runtime прошёл native Windows SIGBREAK
(Ctrl+Break), который дополнительно направляется в ту же shutdown процедуру.
После проверок нет worker connections или временных queue schemas.
Web отдельно запущен с HTTP 200 без worker; application migrations и
пользовательская схема не менялись.

## Доказательство LFS-107

На закреплённом pg-boss 12.38.1 / Drizzle 0.45.4 / pg 8.23.1 проверен
`boss.send(..., { db: fromDrizzle(tx, sql) })` внутри Drizzle transaction.
Реальные PostgreSQL tests доказывают совместный commit, rollback после enqueue,
sequential/concurrent producer dedupe и повторяемость тестового SQL consumer.
Новая disposable fixture отсутствует в application migrations и production exports.

Полное решение, код, изоляция, повторный запуск и ограничения at least once:
[ADR-002: queue atomicity](002-queue-atomicity.md). Это дополнение к исходному
решению, не смена очереди или драйвера. Production business consumers пока
не реализованы; гарантия fixture не означает exactly once для внешних эффектов.
