# API-контракты · Foundation

Источник схем и типов — `@lifeos/contracts` (Zod 4.6.7, `z.infer`). Пакет
не зависит от приложений, Node.js или env; DTO пригодны для браузера и worker.
HTTP-адаптеры находятся в `apps/web/server`, env — в отдельном серверном
export `@lifeos/config/env`.

LFS-109: единственный реализованный JSON route — GET /api/health. Кодам
UNAUTHORIZED/FORBIDDEN/AI_UNAVAILABLE/BUDGET_EXCEEDED соответствуют только
контракты и mapper; это не готовые auth/AI APIs. Goals/measurements endpoints,
HTTP producer, pagination и серверный ownership пока не реализованы.

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
| web | `DATABASE_URL` | `NODE_ENV`: development/test/production, default development |
| worker | `DATABASE_URL` | `NODE_ENV`, `WORKER_QUEUE_SCHEMA`: default pgboss |

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
