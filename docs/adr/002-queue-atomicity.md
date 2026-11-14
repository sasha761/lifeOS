# ADR-002 (дополнение) — Атомарность DB write + pg-boss и идемпотентность

- **Статус:** Accepted; подтверждено PostgreSQL integration tests LFS-107.
- **Дата:** 2026-11-12.
- **Связанное решение:** [PostgreSQL/pg-boss](002-postgres-queue.md).
- **Версии:** Node.js 24.22.2, pg-boss 12.38.1, Drizzle ORM 0.45.4,
  node-postgres 8.23.1, PostgreSQL 18.6; версии не менялись.

## Контекст и граница доказательства

Одна операция должна либо сохранить запись и job, либо не сохранить ни одну.
Два отдельных вызова через application pool и внутренний pool pg-boss этого
не обеспечивают: между commit записи и enqueue возможен сбой процесса.
Foundation должна доказать транзакционное поведение до появления пользовательских
таблиц, публичных mutation APIs и реальных бизнес-операций.

Решение проверяется в `packages/db/tests/fixtures/atomic-operations.ts`.
Fixture DDL — `packages/db/tests/fixtures/atomicity.sql`, integration suite —
`packages/db/tests/integration/atomicity.test.ts`. Они не экспортируются из
`packages/db/src`, не входят в `dist` и application Drizzle migrations.
`foundation_test_operations` — обычная таблица с временным сроком жизни теста
в случайной schema. SQL TEMP TABLE не подходит для наблюдения из нескольких
независимых pool connections.

## Проверенный adapter и транзакция

Официальный [adapter API](https://pgboss.io/api/adapters#drizzle) показывает
`fromDrizzle(tx, sql)` и передачу результата через `send(..., { db })`.
На дату работы сайт описывает 12.38.2, поэтому дополнительно проверены
[исходники конкретного tag 12.38.1](https://github.com/timgit/pg-boss/blob/12.38.1/src/adapters/drizzle.ts)
и установленные `dist/adapters/drizzle.js` / `.d.ts`. Adapter передаёт
параметризованный SQL в `tx.execute`; собственного соединения не создаёт.
Совместимость с Drizzle 0.45.4 подтверждена typecheck и реальным enqueue.

Существенная часть проверенного кода:

```ts
return database.transaction(async (tx) => {
  const [inserted] = await tx.insert(table).values({
    id: randomUUID(), idempotencyKey, payload, queueName, jobId: randomUUID(),
  })
    .onConflictDoNothing({ target: table.idempotencyKey }).returning();
  if (!inserted) {
    const [existing] = await tx.select().from(table)
      .where(eq(table.idempotencyKey, idempotencyKey));
    if (!existing) throw new AtomicFixtureError("MISSING_OPERATION");
    if (existing.queueName !== queueName || existing.payload.mode !== payload.mode)
      throw new AtomicFixtureError("CONFLICT");
    return { operationId: existing.id, jobId: existing.jobId, created: false };
  }

  const jobId = await boss.send(queueName, payload, {
    ...FIXTURE_POLICY,
    id: inserted.jobId,
    db: fromDrizzle(tx, sql),
  });
  if (jobId !== inserted.jobId) throw new AtomicFixtureError("ENQUEUE_REJECTED");
  return { operationId: inserted.id, jobId, created: true };
}, { isolationLevel: "read committed" });
```

Это сокращённый фрагмент; полная реализация содержит валидацию, safe errors
и test-only hooks. Drizzle node-postgres
[transaction implementation 0.45.4](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/node-postgres/session.ts)
берёт connection из pool, выполняет BEGIN, callback и COMMIT либо ROLLBACK.
INSERT fixture и INSERT job исполняются через этот же transaction object.
Использовать `fromDrizzle(database, sql)` вместо `fromDrizzle(tx, sql)` нельзя.

PgBoss должен быть настроен на ту же БД и нужную queue schema. Его schema
и очередь создаются до операции; DDL/startup pg-boss не входят в эту транзакцию.
Внутренний pool нужен для lifecycle/наблюдения, но job INSERT в проверенной
функции направлен в Drizzle transaction через `db` option. Нельзя терять этот
option в промежуточных wrappers или выносить enqueue за пределы callback.

`send` может вернуть `null`, например при конфликте job ID. Это не успешный
enqueue: функция бросает ошибку и откатывает новую fixture запись. Отдельный
тест создаёт конфликтующую job заранее, вне проверяемой транзакции; после
ошибки остаётся только эта намеренно предсуществующая job.

## Что доказывают commit и rollback

Внутри callback после enqueue обе записи уже видны через `tx`. SELECT через
Drizzle и через adapter возвращает одинаковые `pg_backend_pid()` и
`txid_current()`. Независимый observer pool в этот момент не видит ни fixture
запись, ни job. После возврата из transaction обе видны, job имеет state `created`.

В rollback-сценарии hook бросает явную ошибку после фактического INSERT job.
После завершения ROLLBACK observer не видит ни запись, ни job, включая поиск
по сохранённому job ID. Повтор с тем же ключом успешно создаёт новую операцию.
Таким образом, проверка различает transaction-bound enqueue и случайную
постановку через отдельный pool: второй вариант оставил бы job после rollback.

## Producer: последовательные и конкурентные повторы

`idempotency_key UNIQUE` в PostgreSQL — источник решения, принят ли запрос
впервые. UUID job сохраняется в записи и используется как явный `send.id`.
Только запрос, вставивший запись через `ON CONFLICT DO NOTHING ... RETURNING`,
ставит job. Duplicate делает новый SELECT и возвращает исходные operation/job IDs,
не создавая очередную job.

Используется явный READ COMMITTED. При конфликте незавершённой вставки UNIQUE
согласует конкурирующие транзакции; следующий SELECT видит committed winner.
Поведение `ON CONFLICT DO NOTHING` и новых снимков описано в
[PostgreSQL 18 isolation](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED).
Тест concurrency сначала открывает две реальные Drizzle transactions на разных
backend PID, синхронизирует их barrier до INSERT и затем ждёт обе операции.
Результат: один `created: true`, одинаковые IDs, одна запись и одна job.
Случайных sleep или предположений о скорости worker в этих проверках нет.

В этой synthetic fixture семантика действия — queue name + demo mode.
Повтор ключа с другим действием отклоняется. Request/correlation IDs считаются
transport metadata: повтор может принести новый context, но существующая job
сохраняет исходный. В будущей бизнес-операции сравнение должно охватывать все
значимые поля валидированного payload, а ключ должен иметь scope пользователя
и операции. Общую production idempotency service эта задача не вводит.

## Consumer: SQL-эффект один раз при повторной доставке

Атомарный enqueue не делает выполнение handler exactly once. При сбое после
commit эффекта, но до подтверждения job, обработка может повториться; consumer
должен быть рассчитан на at least once processing.

Test-only consumer ищет запись по UNIQUE job_id, валидирует delivery и
сопоставляет сохранённый payload. В Drizzle transaction он берёт row lock
`SELECT ... FOR UPDATE`; если `processed_at` уже заполнен, возвращает
`applied: false`. Иначе SQL-эффект (`effect_count + 1`) и `processed_at` изменяются
в одной транзакции. CHECK constraint допускает только состояния «0 / не обработано»
или «1 / обработано». При rollback откатываются и эффект, и marker.

Проверены rollback после изменения, успешный повтор, повторная доставка после
commit эффекта до acknowledgment и конкурентная обработка одного delivery.
Затем реальный `boss.complete` переводит job в `completed`. Повторная доставка
моделируется явным replay полученной через `boss.fetch` job; процесс worker
в этом тесте не убивается. Подтверждение job здесь отдельно от транзакции
эффекта: именно поэтому replay должен безопасно пропускать уже сделанное.

Production `apps/worker` сохраняет прежний demo handler (логи и output).
Durable marker тестовой fixture не добавлен в production worker и не означает
готовую идемпотентность будущих бизнес-handlers. Внешние HTTP/email/payment
эффекты не покрыты SQL-транзакцией; для них потребуются отдельные гарантии
провайдера или outbox с собственным согласованным решением.

## Изоляция, ошибки и cleanup

Suite требует явный `TEST_DATABASE_URL`; существующая защита `readTestDatabaseUrl`
отклоняет application database и совпадающий target. Новая schema
`lfs107_atomic_<uuid>` резервируется через CREATE SCHEMA без IF NOT EXISTS.
Каждый кейс получает отдельную demo queue в этой schema.

Cleanup закрывает PgBoss, выполняет официальный `getUninstallPlans` только для
созданной schema, удаляет известную fixture таблицу и schema с RESTRICT,
закрывает оба application pools. Не используется DROP DATABASE, CASCADE,
удаление volume или изменение основной schema. Suite проверяет отсутствие
namespace после cleanup. Неизвестные SQL/connection errors преобразуются в
безопасные DB errors; URL, credentials и исходный payload не логируются.

## Воспроизведение и ограничения

На закреплённых Node/pnpm из корня:

```sh
pnpm db:test:up
pnpm test:integration
pnpm test:integration
pnpm test:db
pnpm typecheck
pnpm lint
```

`test:integration` последовательно запускает DB и worker PostgreSQL suites;
они не входят в кешируемый root unit task. `test:db` собирает зависимости
DB перед запуском, включая contracts, используемый только test fixtures.
Production migration SQL LFS-104 не меняется.

Гарантия относится к SQL внутри одной PostgreSQL transaction, а не к
произвольным внешним эффектам. Для REPEATABLE READ/SERIALIZABLE и ошибок
`40001` нужен retry всей операции с тем же ключом; такой режим здесь не реализован.
Хранение/TTL ключей, replay ответов публичного API, ownership и бизнес-таблицы
относятся к будущим задачам. Redis, другая очередь и transactional outbox
для доказанного сценария не потребовались.

## Handoff LFS-109

Полная `pnpm verify` повторно проверяет fixture на настоящем PostgreSQL.
Production demo handler и application migration schema не менялись;
test-only marker не объявляется готовой идемпотентностью будущих consumers.
Практический lifecycle/команды: [worker](../architecture/worker.md),
размещение technical/test-only tables: [database](../architecture/database-schema.md).
Текущие PASS/NOT RUN и ограничения публикации: [acceptance](../tasks/STAGE-01-ACCEPTANCE.md).
