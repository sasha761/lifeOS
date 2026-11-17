# API-контракты · Foundation

Источник схем и типов — `@lifeos/contracts` (Zod 4.6.7, `z.infer`). Пакет
не зависит от приложений, Node.js или env; DTO пригодны для браузера и worker.
HTTP-адаптеры находятся в `apps/web/server`, env — в отдельном серверном
export `@lifeos/config/env`.

LFS-201: JSON routes — `GET /api/health`, `GET /api/v1/me` (401 `UNAUTHORIZED`
без сессии) и Better Auth `/api/auth/*` (см. «Auth» ниже). Кодам
FORBIDDEN/AI_UNAVAILABLE/BUDGET_EXCEEDED соответствуют только контракты и
mapper. LFS-202 добавил `GET/PATCH /api/v1/me/preferences` и общее правило
ownership (см. «Preferences и ownership» ниже). LFS-207 добавил защищённые
goals/measurements endpoints, progress и pagination (раздел ниже). HTTP
producer для очереди пока не реализован.

## Envelope

Все ответы обработчиков с `apiRoute` содержат ровно `data`, `meta`, `errors`.
Успех: валидный ненулевой DTO и пустой `errors`. Ошибка: `data: null` и
непустой массив ошибок. Поля `stack`, SQL, детали Zod и исходный ввод
не передаются клиенту. Неизвестные поля DTO отклоняются strict-схемами.

`GET /api/health` возвращает HTTP 200 без обращения к PostgreSQL:

```json
{
  "data": { "status": "ok", "service": "lifeos-web", "timestamp": "2026-11-12T12:00:00.000Z" },
  "meta": {
    "request_id": "b8b9546b-496f-4bc3-903d-0328f3cb67ac",
    "correlation_id": "af347ed1-1e17-4bee-8305-579207023b03"
  },
  "errors": []
}
```

Невалидный DTO/JSON в `parseJsonBody` даёт HTTP 400:

```json
{
  "data": null,
  "meta": {
    "request_id": "b8b9546b-496f-4bc3-903d-0328f3cb67ac",
    "correlation_id": "af347ed1-1e17-4bee-8305-579207023b03"
  },
  "errors": [{ "code": "VALIDATION_ERROR", "message": "Invalid request." }]
}
```

| Код | HTTP | Фиксированное сообщение |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Invalid request. |
| `UNAUTHORIZED` | 401 | Authentication required. |
| `FORBIDDEN` | 403 | Access denied. |
| `NOT_FOUND` | 404 | Resource not found. |
| `RATE_LIMITED` | 429 | Too many requests. |
| `CONFLICT` | 409 | Resource conflict. |
| `INTERNAL_ERROR` | 500 | Internal server error. |
| `AI_UNAVAILABLE` | 503 | AI service unavailable. |
| `BUDGET_EXCEEDED` | 429 | Budget exceeded. |

`ApiError` принимает только код; mapper выбирает статус и сообщение из
фиксированной карты. Любое другое исключение, включая ошибку выходного DTO,
становится `INTERNAL_ERROR`. Вход явно проверяется `parseJsonBody(request, schema)`.
Примеры 400/404/500 исполняются изолированными Vitest handlers; публичного
error endpoint нет. Стандартные Next.js HTML 404 и ответы для неподдерживаемых
методов не переопределяются.

## Идентификаторы и логи

HTTP-helper один раз создаёт новый серверный UUID `request_id` для каждого
запроса. Входной `X-Request-ID` не используется. Валидный UUID из
`X-Correlation-ID` сохраняется; отсутствующее/невалидное значение заменяется
уже созданным `request_id`. Оба ID возвращаются в `meta` и заголовках
`X-Request-ID`/`X-Correlation-ID`, включая ошибки. Ответы имеют `Cache-Control: no-store`.

HTTP log содержит только `event`, HTTP status, код ошибки и оба ID; URL,
query, headers, body и exception не логируются. Correlation ID — техническая
метка, не идентификатор пользователя и не доказательство ownership.

`RequestContext`/`requestContextSchema` используется для будущего enqueue.
`createDemoPayload(mode, context)` переносит ID в существующий demo DTO
`{ correlationId, requestId, mode }` без генерации. Worker валидирует общий
DTO, сохраняет ID при retry, возвращает и логирует их. Старые demo jobs без
`requestId` остаются допустимыми; новые CLI jobs создают один UUID на входе
и используют его для обоих ID. HTTP producer не добавлен. Техническое
доказательство атомарности/идемпотентности на test-only fixture:
[LFS-107 ADR](../adr/002-queue-atomicity.md); публичные mutation APIs пока отсутствуют.

## Idempotency-Key

`HTTP_HEADERS.idempotencyKey` и `idempotencyKeySchema` задают контракт
будущего заголовка: 1–128 ASCII символов `A-Z a-z 0-9 . _ : -`, без пробелов
и переводов строк. Значение непрозрачно, не содержит PII и не логируется.
Health не использует ключ. Хранение, replay, проверка совпадения payload и
scope ownership в LFS-106 не реализуются.

Test-only producer LFS-107 хранит ключ в synthetic fixture, но не реализует
HTTP Idempotency-Key protocol или user-scoped replay ответов. Его гарантия
не должна переноситься на будущие mutation APIs без отдельной реализации.

## Env и запуск

`@lifeos/config/env` экспортирует `readWebEnv`, `readWorkerEnv`,
`readDatabaseEnv` и схемы. Импорт не валидирует env и не открывает соединений.
Парсеры принимают явный объект; по умолчанию читают Node process env только
при вызове. Посторонние переменные исключаются из результата.

| Config | Обязательные | Необязательные |
|---|---|---|
| database | `DATABASE_URL` | — |
| web | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `MAIL_TRANSPORT`, `MAIL_FROM`; `MAIL_OUTBOX_DIR` при outbox, `SMTP_URL` при smtp | `NODE_ENV`: development/test/production, default development; `AUTH_SIGNUP_ALLOWLIST`: default пусто (регистрация закрыта) |
| worker | `DATABASE_URL` | `NODE_ENV`, `WORKER_QUEUE_SCHEMA`: default pgboss |

Auth/mail (LFS-201): `BETTER_AUTH_SECRET` — 32–512 символов без пробелов и
placeholder-значений; `BETTER_AUTH_URL` — http(s) origin без path/query/
credentials; `AUTH_SIGNUP_ALLOWLIST` — до 100 email через запятую;
`MAIL_TRANSPORT=outbox` запрещён при `NODE_ENV=production`; `SMTP_URL` —
`smtp://` или `smtps://`. Web читает результат как `mail: { transport, from,
directory | url }`. Значения, включая SMTP credentials, в ошибки не попадают.

URL должен использовать `postgres:`/`postgresql:`, host и имя БД. Queue schema
содержит 1–50 lowercase ASCII букв/цифр/underscore, начинается с буквы;
`public`, `drizzle`, `information_schema` и префикс `pg_` запрещены.
DB package использует тот же URL-parser и сохраняет защиту отдельной test DB.

Web dev/start проверяют env в `apps/web/scripts/run-next.ts` до загрузки официального
Next CLI. Next.js 16.4.5 может напечатать Ready до завершения instrumentation,
поэтому hook сам по себе не гарантирует раннее завершение процесса. Дополнительная
проверка остаётся в `instrumentation.register`; во время `PHASE_PRODUCTION_BUILD`
она пропускается. Для запуска используйте workspace dev/start scripts. Worker/CLI
проверяют env до создания pg-boss runtime; DB CLI — до создания pool.
Ошибка перечисляет только имена настроек и фиксированные требования;
исходные значения, ZodError и cause с credentials не сохраняются.

Web dev/start и worker загружают root `.env` через Node
`--env-file-if-exists`; переменные процесса имеют приоритет. `pnpm build`
работает без credentials. `apps/web/server/env.ts` помечен `server-only`,
а общий env-export зависит от `node:process` и предназначен только для Node.
Не импортировать env в client components, не передавать config в props и
не добавлять DB credentials в `NEXT_PUBLIC_*` или `next.config.env`.

## Auth (LFS-201)

Better Auth 1.7.18 обслуживает `/api/auth/*` своим JSON-форматом
(`{ code, message }` при ошибке), не envelope `/api/v1`. Используемые endpoints:

| Endpoint | Назначение | Основные ответы |
|---|---|---|
| `POST /api/auth/sign-up/email` | Регистрация `{ name, email, password }` | 200 + cookie; 403 `SIGNUP_NOT_ALLOWED` вне allowlist; 422 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`; 400 длина пароля |
| `POST /api/auth/sign-in/email` | Вход `{ email, password }` | 200 + cookie; 401 `INVALID_EMAIL_OR_PASSWORD` |
| `POST /api/auth/sign-out` | Удаляет серверную сессию | 200 |
| `POST /api/auth/request-password-reset` | `{ email, redirectTo: "/auth/reset-password" }` | 200 одинаково для известных и неизвестных email; 503 `EMAIL_DELIVERY_FAILED`, если письмо не отправлено |
| `GET /api/auth/reset-password/:token` | Ссылка из письма | 302 на `/auth/reset-password?token=…` или `?error=INVALID_TOKEN` |
| `POST /api/auth/reset-password` | `{ token, newPassword }` | 200; 400 `INVALID_TOKEN` (неизвестный, истёкший, использованный) |

В production действует rate limit Better Auth: 429 после 3 попыток входа/
регистрации за 10 с и 3 запросов сброса за 60 с. Запросы с cookie проверяются
на Origin. DTO форм (`signUpInputSchema`, `signInInputSchema`,
`passwordResetRequestSchema`, `passwordResetInputSchema`) и лимиты пароля
8–128 находятся в `@lifeos/contracts`; сервер применяет те же лимиты.

`GET /api/v1/me` — текущая личность в общем envelope:

```json
{ "data": { "id": "…", "email": "owner@example.com", "name": "Owner" }, "meta": { "request_id": "…", "correlation_id": "…" }, "errors": [] }
```

Без валидной сессии — HTTP 401 `UNAUTHORIZED`. Actor определяется только
проверенной cookie-сессией (`lifeos.session_token`); `userId` в body, query или
заголовках игнорируется. Подробности и ограничения — [ADR-005](../adr/005-auth.md).

## Preferences и ownership (LFS-202)

`/api/v1/me/preferences` — настройки **текущего** пользователя; id в URL нет,
владелец — actor проверенной сессии. Сессия проверяется до чтения body.

| Метод | Body | Ответ |
|---|---|---|
| `GET` | — | 200 `{ timezone, locale }`; 401 `UNAUTHORIZED` |
| `PATCH` | `{ timezone?, locale? }`, хотя бы одно поле (`updateUserPreferencesInputSchema`, strict) | 200 сохранённые значения в канонической форме; 400 `VALIDATION_ERROR`; 401 `UNAUTHORIZED` |

```json
{ "data": { "timezone": "Europe/Oslo", "locale": "nb-NO" }, "meta": { "request_id": "…", "correlation_id": "…" }, "errors": [] }
```

- `timezone` — IANA-имя (`Europe/Oslo`, `UTC`, `Etc/GMT+5`), до 64 символов;
  регистр нормализуется по списку runtime (`europe/oslo` → `Europe/Oslo`).
  UTC-offset (`+01:00`), неизвестные зоны и пустые строки → 400.
- `locale` — BCP 47 до 35 символов в канонической форме (`en-us` → `en-US`),
  пригодный для форматирования; `en_US`, `und`, `zz`, списки → 400.
- `userId`/`user_id` и любые другие поля в body → 400 и ничего не меняется;
  `userId` в query и `x-user-id` игнорируются.
- Defaults новых и мигрированных пользователей: `UTC`, `ru`
  (`DEFAULT_USER_PREFERENCES`). Даты хранятся в UTC и показываются в выбранном
  часовом поясе. Better Auth `/api/auth/update-user` эти поля не принимает.

**Правило ownership для всех `/api/v1` ресурсов** ([ADR-006](../adr/006-actor-ownership.md)):
actor только из сессии (`requireApiActor`); repositories фильтруют по
`user_id = actor.userId` (`ownedBy`), services — `requireOwned`. Гость → 401
`UNAUTHORIZED`; чужой, несуществующий или некорректный id → одинаковый 404
`NOT_FOUND` без данных владельца (не 403). `DomainError` отображается в envelope
с фиксированным сообщением кода (`NOT_FOUND` 404, `VALIDATION_ERROR` 400,
`CONFLICT` 409, `FORBIDDEN` 403).

## Ключи жизненных сфер (LFS-203)

`@lifeos/contracts` экспортирует `DOMAIN_KEYS`, `domainKeySchema` и `DomainKey`:
`languages`, `finance`, `work`, `projects`, `skills`, `health` в этом порядке.
Любое будущее DTO с `domain_key` использует эту Zod-схему; седьмой ключ,
`Languages`, строки с пробелами и значения другого типа отклоняются.
Список не зависит от приложений и не дублируется в UI.

`@lifeos/domain` строит из этих ключей неизменяемый `LIFE_DOMAINS`:
локализуемые `name`/`description` (`ru`, `en`), `status`, `available`,
`specializedAvailable`, `url`. `available: true` / `status: available`
обозначают поддержку общих ручных целей; готовность UI создания сюда не
входит. Во всех шести сферах `specializedAvailable: false`. Иконки и цвета
находятся только в Web. Таблица `domains` и отдельный HTTP API реестра не нужны.
Публичные страницы метаданных `/domains/<key>` не читают персональные данные;
неизвестные ключи — HTML 404. Обзор остаётся на `/`, ссылки на `/goals`
проходят существующую проверку сессии. Реализация и проверки:
[LFS-203](../tasks/LFS-203.md).

## Контракты целей (LFS-205)

`createGoalInputSchema` принимает `domain_key`, `title`, optional nullable
`description`, `unit`, `unit_label` (обязателен только для custom), decimal
строки `baseline`/`target`, `direction`, optional `due_at` с явным offset/Z.
`calculation_mode` по умолчанию manual, computed отклоняется; `metric_key`
может быть только null. Все DTO strict: id/user_id/status/timestamps клиент
задавать не может. `updateGoalInputSchema` принимает только metadata:
`title?`, `description?`, `due_at?`, хотя бы одно поле; null очищает nullable
значение. Архивирование — отдельная domain-команда.

Decimal: 0 ≤ value < 10^22, максимум 8 дробных знаков, без JSON number,
экспонент/знаков/пробелов/ведущих нулей; дробные нули нормализуются. NOK — до
2 знаков, count — целое, percent — 0..100, custom/minutes — до 8; конвертации
нет. Increase/decrease требуют соответственно target > / < baseline;
равенство отклоняется. `Goal` возвращает user_id, серверные id/status и ISO UTC
timestamps; current доступен отдельной measurement projection, progress — LFS-207.

Публичные endpoints целей в LFS-205 не создаются. `GoalsService` проверяет
unknown input, Actor/ownership; ошибки VALIDATION_ERROR, NOT_FOUND,
CONFLICT совместимы с HTTP mapper. Политики — [ADR-007](../adr/007-goals.md).

## Audit и повторные команды (LFS-210)

Write-методы `GoalsService` теперь требуют отдельные server options
`{ idempotencyKey, source }`; `source` сейчас web/manual. Эти поля, как и
user_id, не добавляются в goal body. Будущий HTTP adapter LFS-207 получает
ключ из Idempotency-Key и назначает source сам. Публичных endpoints целей
или событий в этой задаче не добавлено.

Ключ длиной 1..128 с прежним wire format закреплён за пользователем сразу
для всех create/update/archive целей. Тот же ключ с нормализованным тем же
запросом не меняет данные повторно и возвращает актуальную ту же цель.
Другой body/target/operation/source — CONFLICT. Неуспешная транзакция ключ
не занимает. No-op edit/repeat archive сохраняет receipt без фиктивного event.

`ActivityEventDraft` — discriminated contract по шести event_type с
schema_version=1. Server добавляет owner, source, key и UTC timestamps.
Before/after whitelist исключает title/description/custom labels и auth PII;
изменение текста отмечается только в changed_fields. Measurement event types
реализованы в LFS-206. Детали — [ADR-008](../adr/008-transactional-audit.md)
и [ADR-009](../adr/009-goal-measurements.md).

## Контракты измерений (LFS-206)

`createGoalMeasurementInputSchema`: обязательные value (decimal string),
measured_at (offset/Z, UTC годы 1..9999, до миллисекунд), optional source=manual
и note=null либо trim 1..1000. Дата может быть раньше создания цели; сервер
отклоняет будущее дальше 5 минут. Правила value общие с единицей родителя;
target не ограничивает value, percent всё ещё ≤100. Update принимает только
value?/measured_at?/note?, хотя бы одно; null очищает note. DTO strict,
id/owner/goal/unit/timestamps клиент не назначает.

`GoalMeasurement` включает server id/goal_id/user_id/unit/source/timestamps.
`GoalMeasurementCurrent` — `{ goal_id, current, measurement }`, где current
равен value последней записи по measured_at/created_at/id DESC, или оба
значения null. Baseline не считается измерением. History — до 100 последних.
Archived parent доступен для чтения, новые write-команды дают CONFLICT.

Сервис требует тот же server options; namespace ключей общий с goal commands.
Create/update replay возвращает актуальное измерение; после его удаления —
NOT_FOUND без повторного создания. Delete replay возвращает узкий
`GoalMeasurementDeletion { id, goal_id, user_id, deleted: true }` из receipt.
Другие body/operation/target/source с занятым ключом — CONFLICT. Note contents
не попадают в audit; note-only edit отмечается changed_fields=["note"].
HTTP endpoints и формулы progress в LFS-206 не добавлены.

LFS-208: Web формы отправляют эти DTO через API ниже. Decimal — строка,
native local datetime переводится из account timezone в explicit UTC;
ambiguous DST требует выбора смещения. Сетевой сбой/500 сохраняет тот же
body/key в памяти открытой формы и предлагает повтор. Поля заморожены до
определённого ответа; no-op/повторы не меняют server semantics. Содержимое
форм и ключи не сохраняются в browser storage. После успешной мутации UI
повторно читает detail/history. Native Next DELETE может содержать zero-byte
stream: он допустим, любое фактическое содержимое тела отклоняется с 400.

## HTTP целей и прогресс (LFS-207)

Все операции ниже требуют verified cookie session. Guest — 401 даже при
невалидном body/id; чужой, неизвестный и malformed UUID — одинаковый 404.
Невалидный JSON/DTO/query/header — 400 VALIDATION_ERROR; архив/занятый ключ
с другим запросом — 409 CONFLICT; internal failure — безопасный 500.
Успешные операции, включая POST/replay/DELETE, возвращают **200** и общий
envelope. Все ответы no-store, request_id/correlation_id остаются в meta и
headers. Неподдерживаемый метод, включая DELETE цели, обрабатывается Next
как 405; это не domain endpoint.

| Метод и URL | Вход / `data` успеха |
|---|---|
| `GET /api/v1/goals` | optional query limit/cursor/domain_key/status; `GoalsPage { items: GoalDetails[], nextCursor }` |
| `POST /api/v1/goals` | CreateGoalInput; `GoalDetails` |
| `GET /api/v1/goals/:goalId` | `GoalDetails { goal: Goal, progress: GoalProgress }` |
| `PATCH /api/v1/goals/:goalId` | UpdateGoalInput metadata **либо** `{status:"archived"}`; `GoalDetails` |
| `GET /api/v1/goals/:goalId/measurements` | optional query limit/cursor; `MeasurementsPage { items: GoalMeasurement[], nextCursor, measurementCount }` |
| `POST /api/v1/goals/:goalId/measurements` | CreateGoalMeasurementInput; `GoalMeasurement` |
| `PATCH /api/v1/goal-measurements/:measurementId` | UpdateGoalMeasurementInput; `GoalMeasurement` |
| `DELETE /api/v1/goal-measurements/:measurementId` | без body; `GoalMeasurementDeletion { id, goal_id, user_id, deleted:true }` |

Каждая запись требует `Idempotency-Key`: 1..128 ASCII `[A-Za-z0-9._:-]`.
POST/PATCH требуют `Content-Type: application/json` (charset допустим).
Body/headers/query не определяют владельца; source команды всегда web.
Неизвестные/повторённые query fields отклоняются; query разрешён только для
двух list endpoints. Status active/completed, смешанный archive + metadata,
правка baseline/target/unit/domain и computed mode отклоняются. Архив
терминальный и читаемый, свежие mutation-команды — 409.

**Повторы.** Namespace `(user_id,key)` общий для goal и measurement команд.
Один нормализованный запрос даёт один эффект/audit/receipt, включая concurrent
retries; JSON key order, эквивалентные decimal и offsets не меняют смысл.
Другая операция/target/body/source с тем же ключом — 409. No-op резервирует
ключ без вымышленного event. Все изменения/audit/receipt атомарны; rollback
не занимает ключ. Create/update replay возвращает актуальное состояние
того же ресурса, не кэшированный response. Measurement после удаления —
404 без resurrection; DELETE с принятым ключом — тот же deletion result.
Новый ключ DELETE отсутствующего id — 404. Goal responses читают progress
после commit: если чтение/доставка ответа сорвалась, повторяйте **тот же**
key/body. Новые meta IDs при replay допустимы. Ключи не истекают в Stage 2.

**Проекция.** `goal` сохраняет прежний snake_case DTO; `progress` имеет поля:

| Поле | Смысл |
|---|---|
| `methodology` | version=1, mode=manual, formula increase/decrease, percentDecimals=2, rounding=half_up, clamped=true |
| `unit`, `baseline`, `target`, `current` | исходные точные значения; current=null без фактов измерений |
| `progressPercent`, `status`, `explanation` | число 0..100 / measured / null либо null / insufficient_data / «Недостаточно данных» |
| `source` | manual — способ задания цели; само по себе не подтверждает current |
| `provenance` | null без замера; иначе kind=self_report, measurementId, source=manual, measuredAt, recordedAt, updatedAt |
| `measurementCount` | все существующие замеры этой цели, не длина страницы и не количество событий |
| `updatedAt` | max goal.updated_at и последнего audit occurred_at; включает правку/удаление/backdated insert |

Current — последняя запись по measured_at/created_at/id DESC. Baseline
никогда не становится замером. Increase `(current-baseline)/(target-baseline)`,
decrease `(baseline-current)/(baseline-target)`; затем ×100, clamp и half-up
до двух знаков. Все суммы/разности/деление считаются BigInt; Number только
для ограниченного UI-процента. Current за пределами target остаётся исходным.
0→50000 NOK при 12000 — 24%; долг 100000→0 при 80000 — 20%.
Без данных current/progressPercent null; измерение 0 — реальные данные.
Baseline==target и обратное направление запрещены input contract. Защитный
calculator при неположительном знаменателе возвращает invalid_definition /
null / «Некорректное определение цели», не делит на ноль.

**Страницы.** Limit default=20, диапазон 1..100. Без domain_key/status список
содержит все свои цели; фильтры используют точные существующие enum values.
Goals идут created_at/id DESC, history — measured_at/created_at/id DESC.
NextCursor null завершает обход. Используйте полученный token целиком:

```ts
const query = new URLSearchParams({ limit: "20", domain_key: "finance", status: "active" });
if (previousPage.nextCursor) query.set("cursor", previousPage.nextCursor);
const response = await fetch(`/api/v1/goals?${query}`, { credentials: "same-origin" });
```

Cursor — versioned tuple token до 512 символов, не authorization token.
Goal cursor привязан к тем же фильтрам; measurement cursor — к goalId.
Malformed/version/scope mismatch — 400. Продолжение не требует существования
cursor row; SQL всегда ограничен session Actor, даже при изменённом token.
Внутри одного ответа READ ONLY REPEATABLE READ связывает goal/count/current.
Между страницами данные живые: новые записи до cursor видны после refresh,
перенос measured_at может переместить запись через границу страницы.
HTTP snapshot export не обещается. Старый domain history из LFS-206
возвращает до 100; этот HTTP history может читать следующие страницы.

**Даты.** Все instants — ISO UTC с миллисекундами; measured_at приходит с
явным offset/Z и сохраняет абсолютный момент. UI использует user preferences
timezone/locale и существующий `formatDateTime` (IANA/DST, fallback UTC),
а не локальные date strings в API. Новые UI экраны — LFS-208.

Схемы: `packages/contracts/src/goals-api.ts`, envelope exports в index;
формула и reader в domain, HTTP в `apps/web/server/goals.ts`, SQL в DB.
Решения и ограничения — [ADR-010](../adr/010-goals-api-progress.md), результаты —
[LFS-207](../tasks/LFS-207.md).

## Dashboard сфер (LFS-204)

`GET /api/v1/dashboard` — read model владельца сессии. Гость и поддельная
сессия — 401; любой query (включая `user_id`) — 400 VALIDATION_ERROR; ответ
no-store в общем envelope. Владелец берётся только из verified Actor.

`Dashboard` (`dashboardSchema`, strict):

| Поле | Содержимое |
|---|---|
| `domains` | ровно 6 сфер в порядке `DOMAIN_KEYS`: `{ key, activeCount, archivedCount, goals }`. `goals` — до 5 (`DASHBOARD_GOALS_PER_DOMAIN`) новейших **активных** целей сферы в формате `GoalDetails`, тот же DTO и расчёт, что `GET /api/v1/goals/:goalId`. Счётчики точные, даже если целей больше лимита. Процента сферы, Life Score или «уровня» нет |
| `today.dueGoals` | до 8 (`DASHBOARD_DUE_GOALS_LIMIT`) активных целей со сроком, ближайшие первыми (включая просроченные), `GoalDetails` |
| `activity` | до 10 (`DASHBOARD_ACTIVITY_LIMIT`) новейших событий `activity_events` владельца: `{ id, type, occurredAt, source, domainKey, goal: { id, title, status }, measurement }`. `measurement` — `{ value, unit, unitLabel }` только у `goal_measurement.*` (для удаления — значение до удаления), иначе null. Title — текущий из goals: audit не хранит названия (ADR-008); заметки и before/after цели не выдаются |

Пустая сфера: `activeCount=0`, `goals=[]`; UI показывает «Нет целей» и CTA,
без 0%. Цель без измерений сохраняет `progressPercent=null` и
«Недостаточно данных». Чтение — один READ ONLY REPEATABLE READ snapshot с
фиксированным числом owner-scoped SQL-запросов (без запроса на цель), как
GoalsReader ([ADR-010](../adr/010-goals-api-progress.md)); snapshots,
materialized views и background projections не используются.

## Официальные API

Использованы [Zod 4 schemas](https://zod.dev/api),
[Next.js instrumentation](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation),
[Next.js environment variables](https://nextjs.org/docs/app/guides/environment-variables)
и [server-only](https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning).
Поведение startup/build проверяется на закреплённом Next.js 16.4.5.

## Evidence и связанные документы

Схемы сверены с `packages/contracts/src/index.ts`, mapper/helper — с
`apps/web/server`, route — с `apps/web/app/api/health/route.ts`. Позитивные и
негативные HTTP/DTO tests: `apps/web/tests/api.test.ts`; startup tests:
`apps/web/tests/startup.test.ts`; wire contracts: `packages/contracts/tests/contracts.test.ts`.
`pnpm test:build` дополнительно запрашивает production health и проверяет ID
headers/no-store через ту же Zod schema. Неизвестный URL остаётся HTML 404.

Текущее состояние и ручные ограничения — [Stage 1 acceptance](../tasks/STAGE-01-ACCEPTANCE.md).
Система: [architecture](../architecture/system.md); очередь: [worker](../architecture/worker.md).
