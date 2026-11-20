# ADR-008 — Транзакционный аудит целей и квитанции повторных команд

- **Статус:** Accepted
- **Дата:** 2026-11-15
- **Задача:** LFS-210; использует [ADR-006](006-actor-ownership.md), [ADR-007](007-goals.md), транзакционный подход [LFS-107](002-queue-atomicity.md).

## Контекст

Цели уже хранятся в обычной таблице. До HTTP API и измерений требуется единая
граница записи: изменение, audit и повтор запроса должны фиксироваться или
откатываться вместе. Журнал не заменяет goals и не является event sourcing.
Queue для синхронного CRUD не нужна; архитектура worker/pg-boss не меняется.

## Решение

**Граница.** `createGoalsService` принимает `GoalsUnitOfWork`, а не отдельный
repository. Каждая write-команда требует серверные `{ idempotencyKey, source }`.
DB-адаптер запускает одну Drizzle-транзакцию `READ COMMITTED` и передаёт domain
callback transaction-bound goals repository и `ActivityEventWriter`. Writer
принимает именно `LifeosTransaction`; root client этому типу не соответствует.
Ошибки callback/SQL откатывают весь набор записей. Ни worker, ни очередь в
этот путь не вовлечены. Подход соответствует
[Drizzle transactions](https://orm.drizzle.team/docs/transactions) и уже
использованной LFS-107 транзакционной композиции.

**Факты.** `activity_events` содержит UUID, user_id, domain_key, goal_id,
event_type, source, target_type/id, optional idempotency_key, schema_version=1,
occurred_at, payload и created_at. Compound FK `(user_id,domain_key,goal_id)`
на goals исключает событие другого владельца или сферы даже при прямом SQL.
Для него goals получает дополнительный UNIQUE с теми же owner/domain/id.
Measurement target_id не является FK на будущую таблицу: audit удаления
должен сохранить target id; parent goal остаётся проверяемой связью владельца.

Реально производятся goal.created/updated/archived. Шесть типов, включая
goal_measurement.created/updated/deleted, имеют strict discriminated contracts;
measurement CRUD/таблицы появятся отдельно в LFS-206. Словарь source включает
manual/web/telegram/import/ai_proposed, но command context и writer сейчас
разрешают только web/manual. Клиентский body не определяет source/owner.

**Минимальный payload.** Before/after содержит unit/baseline/target/direction/
status/due_at. Названия, описания, custom unit labels, user/email/session/password,
raw request и response не копируются. Для metadata-правки changed_fields
показывает изменённые title/description/due_at без текстовых значений; с LFS-217
в нём же unit/unit_label/baseline/target/direction правки определения
([ADR-007, дополнение LFS-217](007-goals.md#дополнение-lfs-217--2026-11-19)).
Reserved measurement snapshot содержит value/measured_at/source, без note.
SQL ограничивает форму/размер JSON и набор ключей; точные типы и переходы
проверяет Zod writer. События append-only на уровне порта: update/delete API нет.

**Идемпотентность.** Узкая таблица `goal_command_receipts` нужна отдельно от
событий: no-op edit и повтор archive не являются новыми фактами, но тоже
должны закреплять ключ. Квитанция хранит owner/key, SHA-256 нормализованных
operation/target/source/input, operation, source, goal/domain id и время.
Raw input и response snapshots не хранятся. FK квитанции также составной.

Scope ключа — **один пользователь и все команды целей**: `(user_id,key)`.
Ключ нельзя переиспользовать с другой операцией, целью, источником или
нормализованным body: CONFLICT. Разные пользователи могут использовать один
ключ независимо. UUID target канонизируется в lowercase; decimal, defaults,
trim и ISO offsets нормализуются контрактом, ключи JSON сортируются.

Replay не повторяет мутацию и audit: возвращает **текущее состояние той же
принадлежащей пользователю цели**, а не кэшированный старый HTTP response.
Поэтому после последующих изменений replay может вернуть новые metadata/status.
Это явная семантика для будущего API LFS-207. Квитанции не истекают в Stage 2,
сохраняются при архивировании и удаляются каскадно с владельцем/целью.
Неуспешная транзакция ключ не занимает: запрос можно исправить/повторить.

**Конкуренция.** Перед чтением квитанции берётся transaction-scoped advisory
lock по hashtextextended(JSON[user_id,key]). Он автоматически освобождается
при commit/rollback; hash collision только сериализует независимые запросы,
реальный scope проверяют PK/полные строки. В READ COMMITTED следующий SELECT
видит commit победителя. PostgreSQL описывает эти гарантии в
[advisory locks](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS).
Для разных ключей одной цели SELECT FOR UPDATE сериализует read-before-write,
чтобы before snapshot соответствовал предыдущему committed after. Время
реальных мутаций/событий — clock_timestamp(), не момент начала ожидающей
транзакции. Для no-op timestamp и event не меняются, receipt создаётся.

DB возвращает типизированный success/conflict/not_found outcome; domain
преобразует его в безопасные ошибки. Runtime dependency DB → domain не
добавляется, используются только типы; domain не импортирует SQL/Node/apps.

## Дополнение LFS-216 · 2026-11-18

Для hard delete выбрана отдельная `goal_deletion_receipts`: owner/key PK,
SHA-256 fingerprint, target UUID и время. Единственный FK — на владельца с
CASCADE; ссылки на удалённую цель, free text, audit и response snapshots нет.
Прежние `goal_command_receipts`, события и измерения каскадно удаляются с целью;
событие `goal.deleted` не создаётся. Удаление и вставка минимальной квитанции
фиксируются одной транзакцией, сбой вставки откатывает DELETE и все каскады.

Общий advisory lock `(user_id,key)` сохранён. Все goal/measurement UOW проверяют
также новую таблицу: её ключ нельзя занять другой операцией, целью или source.
Повтор DELETE с тем же fingerprint возвращает `{ id, user_id, deleted: true }`
без lookup отсутствующей цели. Новый ключ для отсутствующей/чужой цели —
NOT_FOUND. Это сохраняет одновременно безопасный 404 и успешный повтор после
обрыва связи. Квитанции удаления не истекают в Stage 2; с владельцем удаляются.

`0006_goal_deletion_receipts.sql` добавляет только новую таблицу; существующие
FK, SQL и fingerprints не меняются. FK в новом SQL неквалифицирован для
изолированных test schemas. Сначала применяются миграции, затем новый код.
Откат кода сохраняет таблицу, однако старый код не знает её namespace ключей;
при откате нельзя повторять незавершённые команды удаления через старый код.

Альтернатива «любой отсутствующий id уже удалён» отклонена: нарушает требование
404 для неизвестной цели. Nullable FK в прежних receipts усложнил бы инварианты
существующих команд и сохранение их исторических квитанций при удалении.

## Миграция и откат

`0004_activity_events.sql`: две таблицы, compound FK/unique, owner-prefixed
индексы времени и unique event `(user_id,idempotency_key)` для non-null ключей.
Никакого backfill вымышленных событий старых целей. Старые goals не меняются.
В новом SQL UNIQUE goals располагается **до** зависимых FK (Kit генерировал
обратный порядок); FK сделаны неквалифицированными для test schemas, как
в прежних миграциях. 0000–0003 SQL/snapshots остаются неизменными.

Откат кода не требует удаления таблиц, но старый domain API не обеспечивает
audit; до LFS-207 публичных write endpoints всё ещё нет. Откат схемы — только
новая forward-миграция после сохранения данных; applied history не удаляется.

## Альтернативы

- Queue/outbox для простого CRUD: лишняя асинхронность, не даёт требуемой общей
  транзакции изменения и журнала; не используется.
- Только event idempotency key: не закрепляет no-op команды и повтор archive.
- Хранить полные request/response в audit: лишний free text и PII; отклонено.
- Replay старого response: потребовал бы дополнительного хранения личных
  metadata; выбран возврат актуальной цели при единственном эффекте.
- SQL triggers для всей business-логики или event sourcing не вводятся.

## Проверка

Фактические результаты — [LFS-210](../tasks/LFS-210.md). Проверяются event и
receipt insert failures после SQL INSERT, rollback create/edit/archive,
конкурентные повторы, no-op, changed payload conflict, ownership/compound FK,
сериализация before/after, privacy payload, upgrade и Stage 1 worker/atomicity.
