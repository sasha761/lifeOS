# @lifeos/domain

Независимые бизнес-правила и интерфейсы всех сфер LifeOS.

Пакет не импортирует Next.js, React или `apps/*` и не выполняет произвольные
запросы в обход репозиториев. Языковой модуль не определяет архитектуру ядра.
Сборка (`tsc`, ESM + declarations в `dist`) идёт без типов Node, поэтому
исходники не могут незаметно опереться на Node API.

Сейчас пакет содержит:

- `createOpenSignupPolicy()` / `createSignupPolicy(emails)` / `normalizeEmail` —
  кто может создать аккаунт. Открытая политика (режим `open`, по умолчанию с
  LFS-221) пускает любой непустой email. Закрытая (`allowlist`, LFS-201):
  совпадение со списком после trim и без учёта регистра, пустой список
  закрывает регистрацию. Применяется Better Auth перед созданием пользователя;
  вход существующих пользователей не ограничивает.
- `core/` (LFS-202, [ADR-006](../../docs/adr/006-actor-ownership.md)):
  - `Actor` / `actorFromVerifiedSession(userId)` — branded actor; создаётся
    только из проверенной сессии, raw `{ userId }` из запроса — ошибка типов;
  - `DomainError`, `NotFoundError`, `InvalidInputError` — коды для общего API
    envelope, сообщения фиксированы и не содержат данных;
  - `requireOwned(actor, row)` / `requireFound(row)` — чужая и отсутствующая
    запись дают одинаковый `NotFoundError` (HTTP 404, не 403);
  - `createUserPreferencesService(repository)`, `DEFAULT_USER_PREFERENCES`
    (`UTC`, `ru`) и порт `UserPreferencesRepository` — сервис сам валидирует
    вход схемой `@lifeos/contracts`.
- `core/domains.ts` (LFS-203): неизменяемый `LIFE_DOMAINS` и
  `findLifeDomain(unknown)` — шесть сфер с названием/описанием на `ru`/`en`,
  статусом и стабильным URL `/domains/<key>`. Ключи берутся из
  `@lifeos/contracts`; exhaustive metadata обеспечивает полноту реестра.
  `status: available` / `available: true` означают поддержку общей модели
  ручных целей, а не готовность формы создания (LFS-208). Во всём Stage 2
  `specializedAvailable: false`: специализированные трекеры и подключения
  ещё не реализованы. В реестре нет пользовательских данных и UI-иконок.

- `core/goals.ts` (LFS-205/210): `createGoalsService(unitOfWork)` и порт
  `GoalsRepository` — создание/чтение/правка metadata/архивирование ручных
  целей. Actor и SQL ownership обязательны, отсутствующий/чужой id —
  `NOT_FOUND`; правка архива — `CONFLICT`. Определение (baseline/target,
  направление, единица, сфера) неизменно; null очищает description/due_at.
  Записи требуют server options `{ idempotencyKey, source: "web" | "manual" }`;
  `GoalsUnitOfWork` связывает мутацию и аудит в одной транзакции. HTTP adapter
  подключён в LFS-207; он не определяет бизнес-правила.
  Семантика и точность — [ADR-007](../../docs/adr/007-goals.md).
- `core/events.ts` (LFS-210): typed `ActivityEventWriter` и reader port;
  `goalAuditSnapshot` исключает free text и identity. No-op не создаёт event,
  но Unit of Work сохраняет receipt; повтор ключа возвращает актуальную цель
  без второго эффекта. Конкуренция и privacy — [ADR-008](../../docs/adr/008-transactional-audit.md).

- `core/goal-measurements.ts` (LFS-206): create/get/update/remove/current/history,
  порты repository/UOW. Запись требует server options, active owned parent,
  допустимую единицу и measured_at не дальше 5 минут в будущем. Current без
  измерений null, baseline не подставляется. Исправление и удаление сохраняют
  минимальный аудит без текста note. Политики повторов/порядка —
  [ADR-009](../../docs/adr/009-goal-measurements.md).

- `core/goal-progress.ts` (LFS-207): чистый `calculateGoalProgress(unknown)`.
  Формулы increase/decrease через scaled BigInt, half-up до двух знаков
  отображаемого процента, clamp 0..100. Current не меняется, no-data → null,
  неположительный знаменатель → invalid_definition без деления на ноль.
- `core/goals-reader.ts`: `GoalsReader`/`GoalsReadRepository` и owned
  detail/list/history; projection methodology/provenance/count/updatedAt,
  cursor/limit validation. Port гарантирует единый snapshot на read;
  SQL находится в DB. [ADR-010](../../docs/adr/010-goals-api-progress.md).

Зависимость: `@lifeos/contracts` (DTO-схемы). Сборка без Node-типов использует
`skipLibCheck` только для сторонних `.d.ts` (zod упоминает глобальный `URL`).

Проверки: `lint`, `typecheck`, `test` (Vitest) входят в общий `pnpm verify`.
Установка и проверки: [корневой README](../../README.md), [CI](../../docs/CI.md).
