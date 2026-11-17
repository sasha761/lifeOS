# ADR-009 — Ручные измерения, current и повтор удаления

- **Статус:** Accepted
- **Дата:** 2026-11-16
- **Задача:** LFS-206; дополняет [ADR-007](007-goals.md) и [ADR-008](008-transactional-audit.md).

## Контекст

Ручная цель имеет baseline и target, но baseline не подтверждает фактическое
текущее значение. Нужны измерения, исправления и удаление с сохранением аудита.
Общий receipt LFS-210 ссылался только на родительскую цель; повтор DELETE
должен работать и после удаления дочерней строки. HTTP/UI и расчёт progress
относятся к LFS-207/208.

## Решение

**Данные.** `goal_measurements`: UUID, goal_id, user_id, value, measured_at,
source, nullable note, created_at/updated_at. Дополнительный unit копируется
сервером из цели. FK `(user_id,goal_id,unit)` → goals `(user_id,id,unit)`
проверяет владельца и единицу; parent получает соответствующий UNIQUE.
ID/owner/unit/source нельзя менять через update DTO. Source измерения сейчас
только manual; source audit web/manual — отдельный серверный канал команды.

Value — decimal string, numeric без typmod: 0 ≤ value < 10^22, до 8 значащих
дробных знаков; NOK до 2, count целое, percent ≤ 100. Правила общие с целью,
реализованы в contracts и SQL CHECK без округления/Number. Значение может
перейти за target; знак прогресса и формулы здесь не вычисляются.

Note после trim: null или 1..1000 символов. Дата — обязательный абсолютный
момент с offset/Z, UTC годы 1..9999 и точность до миллисекунд. Backdated
разрешён, в том числе до создания цели. Будущее ограничено 5 минутами
от серверных часов (domain и SQL). Created/updated назначаются сервером.

**Current.** Последняя запись по `measured_at DESC, created_at DESC, id DESC`;
updated_at не участвует. Индекс `(user_id,goal_id,measured_at,created_at,id)`
поддерживает обратное сканирование. Такой полный порядок устраняет
неопределённость равных времён, описанную в
[PostgreSQL 18 ORDER BY](https://www.postgresql.org/docs/18/queries-order.html);
адаптер использует [Drizzle orderBy](https://orm.drizzle.team/docs/select#order-by).
Backdated insert и note-only edit не вытесняют более позднее измерение.
Правка measured_at может изменить current; удаление возвращает предыдущую
запись. Если данных нет, `{ current: null, measurement: null }`; baseline
не подставляется. History использует тот же порядок и возвращает до 100
последних записей. Пагинация/полная выгрузка в этой задаче не вводятся.

**Команды и аудит.** `createGoalMeasurementsService` получает
`GoalMeasurementsUnitOfWork`; domain проверяет unknown DTO, Actor и владельца
родителя. Чужое/несуществующее — одинаковый NOT_FOUND. Новые записи,
редактирование и удаление у archived цели дают CONFLICT; чтение и replay
ранее принятой команды остаются доступны.

DB UOW берёт общий advisory owner/key lock из ADR-008, затем parent goal
FOR UPDATE, затем measurement FOR UPDATE. Этот порядок согласует команды
измерений и archive цели и предотвращает потерю before snapshot. Для
update/delete первая неблокирующая owned выборка только находит parent;
после его блокировки child читается заново. Все операции идут в одной
READ COMMITTED транзакции: mutation + event + receipt. SQL удаляет строку
через [DELETE RETURNING](https://orm.drizzle.team/docs/delete); событие
сохраняет target_id после удаления.

Events: goal_measurement.created/updated/deleted, schema_version=1. Snapshot
содержит только value/measured_at/source. В update добавляется changed_fields
из value/measured_at/note. Содержимое заметки не копируется; note-only edit
имеет одинаковые numeric snapshots и флаг note. Поле changed_fields optional
в reader contract ради совместимости с ранее зарезервированным v1 DTO;
новый service записывает его всегда. No-op не меняет updated_at и не создаёт
event, но сохраняет receipt.

**Расширение receipt.** Сохраняется одна таблица goal_command_receipts и
единый namespace `(user_id,key)` для goal и measurement команд. Добавлены
`resource_type` (goal/measurement) и nullable `target_id`; для measurements
target обязателен, три новые операции имеют префикс measurement. Legacy
goal receipts получают DEFAULT goal / null без DML/backfill; прежний
request_hash остаётся байт-в-байт совместимым. Parent FK сохраняется,
child FK отсутствует, чтобы не потерять квитанцию удаления. Raw request,
note и response snapshots в receipt не хранятся.

Одинаковый нормализованный create/update возвращает текущее состояние того
же измерения без второго эффекта. Если оно позже удалено, replay даёт
NOT_FOUND и не воссоздаёт его. Повтор delete с тем же ключом возвращает
`{ id, goal_id, user_id, deleted: true }` из receipt, включая после рестарта.
Новый ключ удаления отсутствующей строки — NOT_FOUND. Изменённые
body/target/operation/source с занятым ключом — CONFLICT. Ключ сохраняется
при удалении child и архиве parent, удаляется каскадно с целью/пользователем.
Разные владельцы независимы. Неуспех транзакции ключ не занимает.

## Миграция и совместимость

`0005_goal_measurements.sql`: новая таблица/индекс/FK, дополнительный UNIQUE
goals, расширение receipt columns и CHECK допустимых operations/resources.
Измерения и события старым целям не придумываются; старые записи не меняются.
В новом SQL UNIQUE находится до зависимого FK; FK неквалифицированный для
изолированных test schemas. Applied SQL/snapshots 0000–0004 не меняются.
Generate повторно не создаёт миграции; снимок соответствует TS schema.

Старый goal writer продолжает работать благодаря defaults. Старый event
reader не понимает новое optional changed_fields измерений: откат такого
reader требует совместимого контракта. Удаление новых таблиц/колонок или
переписывание applied history не является способом отката; нужна отдельная
forward migration после сохранения данных.

## Альтернативы и границы

- Receipt FK на measurement: удалил бы ключ вместе с child; отклонён.
- Хранение полного response/заметки ради replay: лишние личные данные;
  выбран текущий ресурс или узкий deletion result.
- Soft delete/event sourcing: не нужны для сохранения минимального аудита.
- Внешние metric providers, банковский import, очередь и новые runtime
  зависимости не добавляются.

## Проверка

Фактические команды и результаты — [LFS-206](../tasks/LFS-206.md). Тесты
используют два реальных пользователя и PostgreSQL: ownership/compound FK,
decimal и даты, backdating и tie-breaker, изменение/удаление current, durable
retries, общий namespace ключей, parent lock с archive, no-op, note privacy,
откат mutation/event/receipt и upgrade старой квитанции с прежним hash.
