# @lifeos/contracts

Общие strict Zod 4.6.7 DTO и типы через `z.infer`: API envelope
`data/meta/errors`, девять кодов ошибок, health, request/correlation context,
Idempotency-Key и технический demo.ping payload. Пакет не зависит от
приложений и env. Примеры и правила — [API-контракт](../../docs/api/contracts.md).

LFS-203: `DOMAIN_KEYS`, `domainKeySchema` и `DomainKey` — единственный список
шести стабильных ключей сфер. Схема принимает только точные lowercase-ключи:
неизвестные строки, пробелы и другой регистр отклоняются. Будущие API DTO с
`domain_key` используют эту схему; локализуемые названия и capabilities
находятся в `@lifeos/domain`, иконки — в Web.

LFS-205: `CreateGoalInput`, `UpdateGoalInput`, `Goal` и Zod schemas — общая
ручная цель. Decimal принимается строкой (22 целых / 8 дробных), сравнивается
точно через BigInt; единицы и направление проверяются совместно. Computed,
клиентские user_id/id/status/timestamps и правка определения отклоняются.
`goalInstantSchema` нормализует явный offset в ISO UTC. Политики —
[ADR-007](../../docs/adr/007-goals.md). Import и require conditions указывают
на один ESM artifact; require нужен Drizzle Kit на Node 24.

LFS-210: strict discriminated `activityEventDraftSchema`, event metadata и
`GoalCommandOptions` — версия 1 и шесть типов событий. Before/after содержит
только whitelisted numeric/status/date fields; title/description отмечаются
через changed_fields без значений. В source зарезервированы пять значений,
серверный writer пока принимает web/manual. Общая схема Idempotency-Key
перенесена в leaf `src/idempotency.ts` без изменения wire format.

LFS-206: `CreateGoalMeasurementInput`, `UpdateGoalMeasurementInput`,
`GoalMeasurement`, `GoalMeasurementCurrent` и `GoalMeasurementDeletion`.
Create: exact value, measured_at, optional note/manual source; update:
value/measured_at/note. Owner/goal/unit/timestamps задаются сервером.
Общий `goalValueMatchesUnit` исключает расхождение правил целей и измерений.
Current связывает measurement и его значение, no-data представлен null.
Measurement update audit содержит optional changed_fields без note text.
[Политики](../../docs/adr/009-goal-measurements.md).

LFS-207: `GoalDetails { goal, progress }`, `GoalProgress`, `GoalsPage`,
`MeasurementsPage`, strict list queries и `PatchGoalInput` (metadata либо
archive). Progress включает exact values, nullable progressPercent,
methodology/provenance/count/updatedAt; без измерений — insufficient_data.
Responses экспортируют общий envelope. Versioned seek cursors валидируют
tuple dates/UUID/scope, limit 1..100 (default 20). Формат, ошибки и повторы:
[HTTP docs](../../docs/api/contracts.md#http-целей-и-прогресс-lfs-207).

ESM export и declarations собираются в `dist` через `pnpm build`.
Root lint/typecheck/test/build включают пакет и его dependencies.
Для отдельной unit suite: `pnpm --filter @lifeos/contracts test`.
