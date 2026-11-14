# @lifeos/contracts

Общие strict Zod 4.6.7 DTO и типы через `z.infer`: API envelope
`data/meta/errors`, девять кодов ошибок, health, request/correlation context,
Idempotency-Key и технический demo.ping payload. Пакет не зависит от
приложений и env. Примеры и правила — [API-контракт](../../docs/api/contracts.md).

ESM export и declarations собираются в `dist` через `pnpm build`.
Root lint/typecheck/test/build включают пакет и его dependencies.
Для отдельной unit suite: `pnpm --filter @lifeos/contracts test`.
