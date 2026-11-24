# API-контракты

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
| web | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `MAIL_TRANSPORT`, `MAIL_FROM`; `MAIL_OUTBOX_DIR` при outbox, `SMTP_URL` при smtp | `NODE_ENV`: development/test/production, default development; `AUTH_SIGNUP_MODE`: open/allowlist, default open; `AUTH_SIGNUP_ALLOWLIST`: default пусто (в режиме allowlist — регистрация закрыта) |
| worker | `DATABASE_URL` | `NODE_ENV`, `WORKER_QUEUE_SCHEMA`: default pgboss |

Auth/mail (LFS-201): `BETTER_AUTH_SECRET` — 32–512 символов без пробелов и
placeholder-значений; `BETTER_AUTH_URL` — http(s) origin без path/query/
credentials; `AUTH_SIGNUP_MODE` — `open` (регистрируется любой email) или
`allowlist` (LFS-221); `AUTH_SIGNUP_ALLOWLIST` — до 100 email через запятую,
читается только в режиме `allowlist`;
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
| `POST /api/auth/sign-up/email` | Регистрация `{ name, email, password }` | 200 + cookie; 403 `SIGNUP_NOT_ALLOWED` только в режиме `allowlist` для email вне списка; 422 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`; 400 длина пароля |
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
задавать не может. `updateGoalInputSchema` принимает metadata
`title?`, `description?`, `due_at?` и (LFS-217) определение целиком:
`unit`, `unit_label` (null у не-custom), `baseline`, `target`, `direction` —
все пять вместе или ни одного; хотя бы одно поле; null очищает nullable
значение. Определение проверяется теми же правилами, что при создании;
частичное определение — VALIDATION_ERROR. Менять его можно, только пока у цели
нет измерений: иначе CONFLICT; то же определение без изменений — не правка.
`domain_key` не меняется. Архивирование — отдельная domain-команда.

Decimal: 0 ≤ value < 10^22, максимум 8 дробных знаков, без JSON number,
экспонент/знаков/пробелов/ведущих нулей; дробные нули нормализуются. NOK и USD
(LFS-218) — до 2 знаков, count — целое, percent — 0..100, custom/minutes — до 8;
конвертации нет. `Goal.origin` (LFS-218) — `manual` | `starter` | `onboarding`,
назначается только сервером; клиентские DTO его не принимают. Increase/decrease требуют соответственно target > / < baseline;
равенство отклоняется. `Goal` возвращает user_id, серверные id/status и ISO UTC
timestamps; current доступен отдельной measurement projection, progress — LFS-207.

**LFS-225 ([ADR-013](../adr/013-goal-kinds-phases.md)).** `createGoalInputSchema` — объединение двух видов:
числовая цель (как выше, `kind: "numeric"` по умолчанию) и `{ kind: "unmeasured", domain_key, title, description?,
starts_at?, due_at? }` без единицы и чисел (лишнее поле — VALIDATION_ERROR). У любой цели optional `starts_at`;
если заданы обе даты, `starts_at ≤ due_at`, иначе VALIDATION_ERROR (и при правке одной даты против сохранённой
другой). `Goal` добавляет `kind`, `phase` (`planned | in_progress | paused | achieved`), `phase_changed_at`,
`starts_at`; у цели без измерений `unit`, `unit_label`, `baseline`, `target`, `direction` — `null`. Определение
у цели без измерений не правится — CONFLICT. Мастер, пример и «Новая цель» пользуются
`createNumericGoalInputSchema`.

**LFS-226 ([ADR-013](../adr/013-goal-kinds-phases.md#дополнение-lfs-226--2026-11-25)).** Числовая цель
принимает и возвращает `measurement_mode`: `current_value` по умолчанию, `contributions` для взносов.
У цели без измерений в ответе `null`; поле в её POST отклоняется с 400, попытка задать его в PATCH — с 409.
До первого собственного измерения режим можно менять отдельным PATCH или вместе с обычной правкой. После первой
записи смена режима даёт 409, даже если запись была удалена.

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
изменение текста отмечается только в `changed_fields`. У `goal.updated` список ограничен `GOAL_CHANGED_FIELDS`.
Значения числового определения, статуса, дат и режима измерений фиксируются в before/after; для `unit_label`
записывается только факт изменения. Measurement event types
реализованы в LFS-206. Детали — [ADR-008](../adr/008-transactional-audit.md)
и [ADR-009](../adr/009-goal-measurements.md).

## Контракты измерений (LFS-206)

`createGoalMeasurementInputSchema`: обязательные value (decimal string),
measured_at (offset/Z, UTC годы 1..9999, до миллисекунд), optional source=manual
(`GoalMeasurement.source` бывает и `example` — только из примера LFS-218; такое
измерение нельзя исправить, CONFLICT)
и note=null либо trim 1..1000. Дата может быть раньше создания цели; сервер
отклоняет будущее дальше 5 минут. Правила value общие с единицей родителя;
target не ограничивает value, percent всё ещё ≤100. Update принимает только
value?/measured_at?/note?, хотя бы одно; null очищает note. DTO strict,
id/owner/goal/unit/timestamps клиент не назначает.

`GoalMeasurement` включает server id/goal_id/user_id/unit/source/timestamps.
`GoalMeasurementCurrent` — `{ goal_id, current, measurement }`, где current
вычисляется по режиму цели. `measurement` — последняя запись по measured_at/created_at/id DESC. При
`measurement_mode: "contributions"` current — результат пересчёта по всем взносам, а value — сумма отдельного взноса.
Для взноса требуется value > 0 при создании и исправлении. Без записей оба значения null. History — до 100 последних.
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
headers. Неподдерживаемый метод обрабатывается Next
как 405; это не domain endpoint.

| Метод и URL | Вход / `data` успеха |
|---|---|
| `GET /api/v1/goals` | optional query limit/cursor/domain_key/status; `GoalsPage { items: GoalDetails[], nextCursor }` |
| `POST /api/v1/goals` | CreateGoalInput; `GoalDetails` |
| `GET /api/v1/goals/:goalId` | `GoalDetails { goal: Goal, progress: GoalProgress }` |
| `PATCH /api/v1/goals/:goalId` | UpdateGoalInput (metadata, в том числе `starts_at`, определение целиком из LFS-217 и/или `measurement_mode` из LFS-226) **либо** `{status:"archived"}` **либо** `{phase}` (LFS-225: смена статуса, тот же статус — без изменений, архивная цель — 409); `GoalDetails` |
| `DELETE /api/v1/goals/:goalId` (LFS-216) | без body; `GoalDeletion { id, user_id, deleted:true }` |
| `POST /api/v1/starter-pack` (LFS-218) | без body; `StarterPackApplied { version:1, created_goals, created_measurements }`; пример уже в аккаунте — 409 |
| `DELETE /api/v1/starter-pack` (LFS-218) | без body; `StarterPackRemoved { deleted_goals }` |
| `GET /api/v1/goals/:goalId/measurements` | optional query limit/cursor; `MeasurementsPage { items: GoalMeasurement[], nextCursor, measurementCount }` |
| `POST /api/v1/goals/:goalId/measurements` | CreateGoalMeasurementInput; `GoalMeasurement`; цель без измерений (LFS-225) и архивная — 409 |
| `PATCH /api/v1/goal-measurements/:measurementId` | UpdateGoalMeasurementInput; `GoalMeasurement` |
| `DELETE /api/v1/goal-measurements/:measurementId` | без body; `GoalMeasurementDeletion { id, goal_id, user_id, deleted:true }` |

Каждая запись требует `Idempotency-Key`: 1..128 ASCII `[A-Za-z0-9._:-]`.
POST/PATCH требуют `Content-Type: application/json` (charset допустим).
DELETE отклоняет любое непустое тело. Переданный Origin должен совпадать
с публичным origin приложения (`BETTER_AUTH_URL`); чужой Origin, включая `null`,
даёт 403 FORBIDDEN. Внутренний адрес Next и входящие Host headers не считаются доверенными.
Запросы без Origin допустимы; CORS не включён.
Body/headers/query не определяют владельца; source команды всегда web.
Неизвестные/повторённые query fields отклоняются; query разрешён только для
двух list endpoints. Status active/completed, смешанный archive + metadata,
частичное определение, правка domain и computed mode отклоняются; новое
определение у цели с измерениями — 409 (LFS-217). Архив
терминальный и читаемый, свежие команды редактирования/измерений — 409.
Активную и архивную цель владелец может удалить навсегда отдельным DELETE.

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

LFS-216: DELETE цели удаляет её, все измерения, события журнала и прежние
квитанции в одной транзакции. Корзины и восстановления нет. Только минимальная
квитанция удаления (owner/key/hash/target UUID/time, без FK на цель и без
metadata) остаётся для успешного повтора с тем же ключом; при удалении
владельца она тоже удаляется. Новая операция использует общий namespace ключей
всех goal/measurement команд. Нет `goal.deleted` event или response snapshot.
После удаления прежние create/update receipts уже отсутствуют: их ключи не
обеспечивают replay удалённых данных. Подробнее — [ADR-008](../adr/008-transactional-audit.md).

**Проекция.** `goal` сохраняет прежний snake_case DTO; `progress` имеет поля:

| Поле | Смысл |
|---|---|
| `methodology` | version=1, mode=manual, formula increase/decrease, percentDecimals=2, rounding=half_up, clamped=true; null у цели без измерений |
| `unit`, `baseline`, `target`, `current` | исходные точные значения; current=null без фактов измерений; у цели без измерений все null |
| `progressPercent`, `status`, `explanation` | число 0..100 / measured / null либо null / insufficient_data / «Недостаточно данных»; у цели без измерений (LFS-225) null / unmeasured / слово статуса («В процессе», «Достигнута»…) |
| `source` | manual — способ задания цели; само по себе не подтверждает current |
| `provenance` | null без замера; иначе kind=self_report и source=manual (своё значение) или kind=example и source=example (LFS-218), measurementId, measuredAt, recordedAt, updatedAt |
| `contributionTotal` | точная сумма оставшихся записей при взносах; поле есть только при наличии взносов |
| `measurementModeLocked` | `true`, если есть или было собственное измерение; иначе поля нет |
| `measurementCount` | все существующие замеры этой цели, не длина страницы и не количество событий |
| `updatedAt` | max goal.updated_at и последнего audit occurred_at; включает правку/удаление/backdated insert |

В режиме `current_value` current — значение последней записи по measured_at/created_at/id DESC. В режиме
`contributions` это старт плюс сумма взносов при increase и max(0, старт минус сумма) при decrease. Provenance
указывает на последнюю запись в обоих режимах. Increase `(current-baseline)/(target-baseline)`,
decrease `(baseline-current)/(baseline-target)`; затем ×100, clamp и half-up
до двух знаков. Все суммы/разности/деление считаются BigInt; Number только
для ограниченного UI-процента. Current за пределами target остаётся исходным.
Взнос 800 USD при долге 2000 USD даёт current 1200 и прогресс 40%. При переплате остаток и долг не ниже нуля,
накопленная сумма может превышать цель. Сумма и вычисленный current могут иметь больше целых разрядов, чем отдельное
измерение. Без записей current/progressPercent null; в режиме `current_value` измерение 0 остаётся допустимым.
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
| `activity` | до 10 (`DASHBOARD_ACTIVITY_LIMIT`) новейших событий `activity_events` владельца: `{ id, type, occurredAt, source, domainKey, goal: { id, title, status }, measurement }`. `measurement` — `{ value, unit, unitLabel, contributionKind? }` только у `goal_measurement.*` (для удаления — значение до удаления), иначе null. Title — текущий из goals: audit не хранит названия (ADR-008); заметки и before/after цели не выдаются, кроме `phase` — `{ before, after }` у смены статуса (LFS-225), иначе null |
| `examples` | LFS-218: `{ goals, measurements }` — цели с `origin = starter` (активные и архивные) и измерения с `source = example`; для баннера «Это пример». Два счётчика в том же snapshot, без запроса на цель |
| `focus_domains` | LFS-219: сферы в фокусе из мастера, в порядке реестра; `[]`, если мастер не пройден. Порядок `domains` не меняется |

У записей `activity` есть `example` (LFS-218): факт загрузки примера
(`source = starter`) или факт о примерном значении.

Пустая сфера: `activeCount=0`, `goals=[]`; UI показывает «Нет целей» и CTA,
без 0%. Цель без измерений сохраняет `progressPercent=null` и
«Недостаточно данных». Чтение — один READ ONLY REPEATABLE READ snapshot с
фиксированным числом owner-scoped SQL-запросов (без запроса на цель), как
GoalsReader ([ADR-010](../adr/010-goals-api-progress.md)); snapshots,
materialized views и background projections не используются.

## Журнал действий (LFS-213)

`GET /api/v1/activity` — журнал `activity_events` владельца сессии, новые
сверху. Нужен для «Истории изменений» на панели цели и «Последних действий в
сфере». Гость и поддельная сессия — 401 (до чтения query); ответ no-store в
общем envelope.

Query (`activityQuerySchema`, strict): `limit` 1–50, по умолчанию 10
(`ACTIVITY_LIMIT_DEFAULT`, `ACTIVITY_LIMIT_MAX`); не больше одного фильтра —
`domain_key` или `goal_id` (UUID, регистр не важен). Оба фильтра сразу,
неизвестный ключ (включая `user_id`), повтор ключа или `cursor` — 400
VALIDATION_ERROR. Курсора пока нет: панель и страница сферы показывают
последние записи. Чужой или несуществующий `goal_id` даёт пустой список, их
нельзя различить.

`ActivityFeed` (`activityFeedSchema`): `{ items }`; запись
(`activityEntrySchema`) — поля записи Dashboard и детали изменения, взятые
только из сохранённого payload:

| Поле | Содержимое |
|---|---|
| `id`, `type`, `occurredAt`, `source`, `domainKey`, `goal` | как в `activity` Dashboard; `goal.title` — текущее название (audit не хранит названия, ADR-008) |
| `measurement` | `{ value, previousValue, unit, unitLabel }` у `goal_measurement.*`, иначе null; `previousValue` — значение до исправления, только у `goal_measurement.updated`. `unit` и `unitLabel` — null у измерения, записанного до последней смены единицы цели (LFS-217): журнал не хранит единицу измерения, поэтому значение показывается числом |
| `changedFields` | у `goal.updated` — какие поля изменены (`GOAL_CHANGED_FIELDS`), иначе null. Сами название, описание и своя единица в журнале не хранятся |
| `startsAt` | у `goal.updated` с изменённой датой начала (LFS-225) — `{ before, after }` (UTC instant или null), иначе null |
| `dueAt` | у `goal.updated` с изменённым сроком — `{ before, after }` (UTC instant или null), иначе null |
| `phase` | у смены статуса (`changed_fields: ["phase"]`, LFS-225) — `{ before, after }`, иначе null |
| `measurement.contributionKind` | `payment` или `deposit` для события взноса, иначе поля нет |
| `definition` | у `goal.updated` с изменёнными `unit`/`baseline`/`target`/`direction` — `{ before, after }` с этими четырьмя полями (LFS-217), иначе null |

Чтение — один owner-scoped SQL-запрос с join на `goals` по составному ключу
(владелец, сфера, цель) и существующими индексами
`(user_id, domain_key|goal_id, occurred_at, id)`; миграций нет. Dashboard
строит свои записи той же нормализацией (`toDashboardActivity`). Время
последней смены единицы цели оба reader берут коррелированным подзапросом на
каждую строку: индекс `(user_id, goal_id, …)` сужает поиск до событий цели,
`event_type` и `changed_fields` проверяются построчно. В Dashboard с LFS-217
`measurement.unit` тоже может быть null.

## Пример по выбору пользователя (LFS-218)

`POST /api/v1/starter-pack` загружает пример версии 1: 7 целей с
`origin = starter` во всех шести сферах без сроков и по одному измерению
`source = example`, факты аудита с `source = starter`. `DELETE` («Удалить все
примеры») удаляет все цели с `origin = starter` с их измерениями, историей и
квитанциями; цели `manual` и `onboarding` остаются. Оба метода: сессия (401),
Origin публичного URL (403), обязательный `Idempotency-Key`, без query и body
(400). Повтор с тем же ключом возвращает тот же ответ. Новый ключ при
существующем примере — 409 `CONFLICT` (текст «Пример уже в аккаунте» показывает
попап LFS-220, сообщение API фиксировано по коду). Ничего не создаётся при
регистрации. С LFS-220 `POST` в той же транзакции завершает начальную
настройку, если она ещё не пройдена: `onboarding_state.status = completed`,
`choice = example`, `completed_at`. Уже пройденная настройка (мастер) не
меняется: статус, выбор и дата остаются прежними. Журнал: `changedFields` может содержать `origin`, у записи есть
`example`. Решения — дополнения LFS-218 к [ADR-007](../adr/007-goals.md),
[ADR-008](../adr/008-transactional-audit.md) и [ADR-009](../adr/009-goal-measurements.md).

## Мастер начальной настройки (LFS-219)

Решения — [ADR-012](../adr/012-onboarding.md). Ресурс всегда принадлежит владельцу сессии: user id нет ни в URL,
ни в теле.

| Метод | Тело и ответ |
|---|---|
| `GET /api/v1/onboarding` | без query; `OnboardingState { status, choice, catalog_version, answers, completed_at, updated_at, focus_domains, goals }`. Без строки — `not_started`, `answers: null`; черновик другой версии каталога — `answers: null` |
| `PUT /api/v1/onboarding` | `{ answers }` — черновик целиком («Сохранить и выйти»), JSON, Origin публичного URL, без query. `Idempotency-Key` не нужен: черновик заменяется целиком. Статус → `in_progress`; `completed` остаётся `completed`; `choice = wizard`. Цели не создаются. Ответ `OnboardingState` |
| `PATCH /api/v1/onboarding` | LFS-220. Ровно одно из: `{ status: "in_progress", choice: "wizard" }` («Начать настройку»), `{ status: "dismissed", choice: "blank" }` («Начать с чистого листа»). `{ checkin_rhythm }` удалён в LFS-222 и даёт 400. JSON, Origin, без query, `Idempotency-Key` не нужен: повтор даёт то же состояние. Ответ `OnboardingState` |
| `POST /api/v1/onboarding/complete` | `{ answers, selected }` («Создать N целей»): JSON, Origin, `Idempotency-Key`. Ответ `OnboardingCompleted { catalog_version: 1, created_goals }` |

Поля `OnboardingState` с LFS-220 (поле `checkin_rhythm` удалено в LFS-222):
- `focus_domains` — сферы в фокусе в порядке реестра, `[]` если не выбраны;
- `goals: { total, onboarding, examples }` — все цели владельца, цели мастера (`origin = onboarding`) и цели с меткой
  «Пример» (`origin = starter`), активные и в архиве.

Переходы `PATCH` (LFS-220):

| Сейчас | `wizard` → `in_progress` | `blank` → `dismissed` |
|---|---|---|
| нет строки, `not_started`, `in_progress`, `dismissed` | да | да |
| `completed` | 409 `CONFLICT` | 409 `CONFLICT` |

Черновик ответов и его версия каталога при переходе сохраняются. Проверка и запись — один условный upsert, поэтому
параллельное завершение мастера не будет перезаписано. Переход в `completed` через `PATCH` невозможен (400): настройку
завершают только «Создать N целей» и загрузка примера. Другие пары, `checkin_rhythm`, лишние поля (в том числе
`user_id`) и пустое тело — 400.

`OnboardingAnswers` (strict, с LFS-222 без ритма и пояса):
- `step` — `domains` | ключ выбранной сферы | `summary`;
- `domains` — ключи реестра без повторов в его порядке («сферы в фокусе»);
- `spheres` — `{ <sphere>: { skipped, choices[] } }`;
- `extra` — до 6 целей «+ Добавить цель в другой сфере» в формате `CreateGoalInput`;
- `unchecked` — ключи снятых галочек.

Даты сроков в ответах — моменты UTC; мастер показывает их в часовом поясе профиля, который меняют только в Настройках.
`PUT` и `complete` с `rhythm`, `timezone` или `step: "rhythm"` — 400. Черновик, сохранённый до LFS-222, при чтении
(`GET`) отдаётся без `rhythm` и `timezone`, а шаг `rhythm` превращается в `summary`.

Выбор (`OnboardingChoice`) — `{ option, subject, direction, unit, unit_label, baseline, target, due_at }`. Числа —
строки как ввели, до 40 символов: «3 000» и «21,1» допустимы в черновике и нормализуются при сборке. Варианты и лимиты —
`ONBOARDING_OPTIONS` и `ONBOARDING_CHOICE_LIMITS` (Здоровье — до 3, остальные — 1). Ключ предложенной цели —
`<sphere>.<option>` или `extra.<n>`.

`complete` заново строит цели из ответов и создаёт только отмеченные в `selected`:
- одной транзакцией создаются цели с `origin = onboarding` и `goal.created` с `source = web` (ключ у первого факта);
- в профиль пишутся только `focus_domains`; часовой пояс профиля не меняется (LFS-222);
- состояние становится `completed`, создаётся квитанция `onboarding_receipts`;
- измерений нет.

Ошибки:
- цель, которая не проходит контракт создания, или неизвестный ключ в `selected` — 400 `VALIDATION_ERROR` с
  `errors[0].field` (`health.own`, `skills.chess`); ничего не создаётся;
- повтор с тем же ключом возвращает тот же ответ, тот же ключ с другими данными — 409; ключ занят другой командой
  целей или примера — 409.

`ApiError` (общий envelope, с LFS-219) — `{ code, message, field? }`. `field` — фиксированный ключ из структуры
запроса (`^[a-z0-9_.]{1,64}$`), никогда не введённый текст.

Dashboard (LFS-219): `focus_domains` — сферы в фокусе в порядке реестра, по умолчанию `[]`. UI показывает их первыми,
`domains` остаются в порядке `DOMAIN_KEYS`.

Dashboard (LFS-220): `onboarding: { status, show_start }`, по умолчанию `{ status: "not_started", show_start: false }`.
`show_start` сервер считает в том же снимке: у владельца нет ни одной цели (активной или в архиве), и статус
`not_started` или `in_progress`. Контракт отклоняет `show_start` при других статусах или при наличии целей. Попап
показывается по этому полю, отдельного запроса нет; браузер помнит только «✕» до конца сессии (`sessionStorage`).

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
