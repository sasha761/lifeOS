# ADR-010 — Goals HTTP API, точный прогресс и чтение страниц

- **Статус:** Accepted
- **Дата:** 2026-11-16
- **Задача:** LFS-207; дополняет [ADR-007](007-goals.md), [ADR-008](008-transactional-audit.md), [ADR-009](009-goal-measurements.md).

## Контекст

Цели, измерения и транзакционные команды уже реализованы. Нужен безопасный
HTTP-контракт с прогрессом и ограниченной историей. Нельзя считать baseline
фактом измерения, терять точность NOK, раскрывать чужие записи или менять
смысл сохранённых idempotency receipts. Web UI остаётся в LFS-208.

## Решение

**HTTP.** Девять операций под `/api/v1` (с LFS-216): GET/POST goals, GET/PATCH/DELETE goal,
GET/POST goal measurements и PATCH/DELETE measurement. Все используют
существующий apiRoute/envelope, fixed safe errors, no-store и request IDs.
Сессия проверяется до чтения params/query/body. Source команды — серверный
web; user_id берётся только из verified Actor. GET возвращает 401 гостю,
404 на чужой/отсутствующий/malformed id. Валидация — 400, конфликт — 409,
неожиданная ошибка — безопасный 500. Успех всех операций — 200, включая
повторы POST/DELETE; существующий envelope helper не меняется.

Записи требуют Idempotency-Key, POST/PATCH — application/json. Это вместе
с отсутствием CORS и прежними cookie rules сохраняет требование preflight
для cross-origin browser writes. DELETE body отклоняется. Неизвестные или
повторённые query параметры отклоняются, x-user-id не определяет Actor.
Query поддерживается только в двух list endpoints.

PATCH goal принимает metadata **либо** `{ status: "archived" }` отдельно; с LFS-217
вместе с metadata можно передать определение целиком, пока у цели нет измерений
([ADR-007](007-goals.md), дополнение LFS-217).
Смешанное архивирование/правка отклоняется до записи. Терминальный archive,
no-op receipts, audit и fingerprint остаются прежними domain-командами;
новой операции/миграции квитанций для PATCH нет. Reopen запрещён.
Hard delete добавлен LFS-216 (дополнение ниже).
Сигнатуры params Promise сверены с документацией установленного Next 16.4.5:
`apps/web/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`.

**Процент.** Чистая `calculateGoalProgress` в domain:

- increase: `(current-baseline)/(target-baseline)`;
- decrease: `(baseline-current)/(baseline-target)`;
- результат умножается на 100, ограничивается 0..100 и округляется half-up
  до двух десятичных знаков для отображения;
- все суммы и разности — BigInt в единицах 10^-8; в Number переводится
  только ограниченное число сотых процента. Current не округляется и не
  ограничивается target;
- current=null → progressPercent=null, insufficient_data и «Недостаточно
  данных»; измерение 0 — данные, может дать реальный 0% или 100% для долга;
- неположительный знаменатель при имеющемся current → invalid_definition,
  null и «Некорректное определение цели». API создания по ADR-007 всё ещё
  отклоняет baseline==target/неправильное направление с 400; защитный расчёт
  не делит на ноль и не объявляет такую цель выполненной.

`GoalDetails = { goal, progress }`: прежний Goal DTO не меняется. Progress
содержит methodology (version/formula/rounding/clamp), unit, exact baseline/
target/current, progressPercent/status/explanation, source=manual,
measurementCount и updatedAt. Provenance — null без измерений или self_report
с id/датой последнего измерения и временем его записи/правки. Note не
копируется в progress. Source manual без provenance описывает метод цели,
а не наличие подтверждённого значения. Фиктивных оценок достоверности нет.

**Чтение.** Новый GoalsReader зависит от read repository port. DB-адаптер
выполняет READ ONLY REPEATABLE READ на один HTTP read: goal rows, counts,
последние измерения и время изменения видят одну версию данных, включая
параллельные commits. Гарантия snapshot соответствует
[PostgreSQL 18 Repeatable Read](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-REPEATABLE-READ).
Write UOW остаются READ COMMITTED с прежними locks и atomicity.

List использует четыре пакетных SELECT: goal page, grouped count, latest
DISTINCT ON и grouped max audit time — без запроса на каждую цель. Detail
использует тот же путь; history — parent, page и count. Все выборки ограничены
Actor; domain повторно проверяет владельца и parent/unit последнего замера.
Latest имеет прежний полный порядок measured_at/created_at/id DESC.
Progress.updatedAt — max(goal.updated_at, последнего audit occurred_at),
поэтому учитывает удаление последнего замера и изменение backdated записи.
Provenance.updatedAt относится только к выбранному измерению. Count — число
существующих измерений, без удалённых, а не число событий или длина страницы.

Write response goal строится отдельным read после commit. Если чтение
не удалось после успешной записи, повтор с тем же ключом не создаёт второго
эффекта. Replay возвращает текущие данные, а не старый response/процент;
это сохраняет ADR-008/009. Measurement writes возвращают прежний measurement
DTO или deletion result. Никаких response snapshots в receipt нет.

**Пагинация.** Limit по умолчанию 20, диапазон 1..100. Обе страницы имеют
items/nextCursor; history дополнительно measurementCount. Repository берёт
limit+1. Goals сортируются created_at/id DESC, optional filters domain_key и
status (без фильтров — все свои цели). History — measured_at/created_at/id DESC.
Используется лексикографический `<` полного tuple, не offset или lookup
cursor row. Порядок/seek соответствуют
[Drizzle cursor guide](https://orm.drizzle.team/docs/guides/cursor-based-pagination)
и [SELECT DISTINCT ON](https://orm.drizzle.team/docs/select#distinct-select),
API проверены по типам Drizzle 0.45.4.

Cursor — versioned seek token до 512 символов: g1!filter!filter!time!id или
m1!goalId!measuredAt!createdAt!id. Клиент передаёт полученную строку целиком
через URLSearchParams и не конструирует её. Фильтры/goalId должны совпасть
с запросом, даты и UUID валидируются. Курсор не подписан и не является
разрешением доступа: даже изменённая корректная позиция остаётся внутри
owned SQL. В нём нет notes, credentials или user identity. Удаление cursor
row не ломает продолжение. Между HTTP страницами список живой: вставки до
позиции видны после refresh, перенос measured_at может переместить запись
через границу страниц. Межзапросный snapshot/export здесь не обещается.

**Время и UI.** Все API даты — ISO UTC с миллисекундами. Данные сохраняют
абсолютный момент; `formatDateTime`/`utcOffsetLabel` из LFS-202 показывают его
по user timezone/locale с учётом DST. Это проверено на переходе Europe/Oslo.
Новые экраны и локализованные date strings в API не вводятся.

## Дополнение LFS-216 · 2026-11-18

`DELETE /api/v1/goals/:goalId` принимает обязательный Idempotency-Key без query
и body (zero-byte stream допустим), возвращает 200 с `GoalDeletion`:
`{ id, user_id, deleted: true }` в прежнем envelope. Auth выполняется первым:
гость получает 401, чужой/несуществующий/malformed id — одинаковый 404.
Архивную цель можно удалить; терминальность архива для правок сохраняется.
Общий commandContext отклоняет переданный Origin, не совпадающий с публичным
origin из настроенного Better Auth baseURL, включая `null`, с 403. Внутренний
Next request.url и клиентские Host/X-Forwarded-Host не задают доверенный origin.
Без Origin разрешены небраузерные запросы;
обязательный custom header, отсутствие CORS и cookie rules сохранены для всех
write endpoints. Тело DELETE измерения и цели проверяется одинаково.

Атомарность и повтор удаления обеспечены `goal_deletion_receipts` без FK на
цель ([ADR-008](008-transactional-audit.md)); после первого успеха тот же ключ
возвращает успех, новый ключ — 404. После commit нет дополнительного read
удалённого ресурса. UI использует прежний механизм повтора body/key, нативный
modal `alertdialog` с отменой и возвратом фокуса на «⋯», затем возвращает на
`/goals` с фильтрами и заново читает список и счётчики Dashboard.

## Миграция, альтернативы и границы

В исходном LFS-207 новых таблиц, индексов, migrations, dependencies и runtime нет.
LFS-216 добавляет только таблицу и миграцию минимальных квитанций удаления. Прежние SQL,
snapshots/journal, lockfile, master plan и write fingerprints сохраняются.
Новый read port не создаёт CQRS subsystem, projection или event sourcing:
читает текущие SQL rows; audit используется только для времени изменения.

Float для сумм, baseline вместо отсутствующего current, offset pagination,
response cache для процентов и автоматическое completed не используются.
Откат кода просто убирает новые endpoints; schema/data не откатываются.
Большие экспорты, cursor snapshot leases, UI и module-specific metrics — вне scope.

## Проверка

Реальные команды/результаты — [LFS-207](../tasks/LFS-207.md). Проверяются exact
increase/decrease/zero/overflow boundaries, 401/404, two-user ownership,
HTTP replay/conflicts/rollback/privacy, pagination/ties/deleted cursor,
consistent snapshot при concurrent commit, timezone DST и production routes.
