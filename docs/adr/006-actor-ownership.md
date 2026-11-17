# ADR-006 — Actor из сессии, ownership ресурсов, timezone/locale пользователя

- **Статус:** Accepted
- **Дата:** 2026-11-15
- **Связанные задачи:** LFS-202; использует [ADR-005](005-auth.md), [ADR-003](003-runtime-boundaries.md); применяется в LFS-205…210

## Контекст

После LFS-201 есть проверенная cookie-сессия Better Auth, но нет общего правила,
как domain-команды получают пользователя и как repositories отделяют чужие
данные. До появления goals/measurements/events (LFS-205+) нужно зафиксировать
один способ, иначе каждая таблица изобретёт свой. Master Plan требует
`user.timezone`/`locale`, UTC в базе и проверку владельца в domain/repository,
а не только в Route Handler или скрытием кнопок.

## Решение

**Actor.** `Actor` (`@lifeos/domain`) — branded тип `{ userId }`. Создаётся
только `actorFromVerifiedSession(userId)` из сессии, которую сервер только что
проверил (`findVerifiedSession` → Better Auth `getSession`). Route Handlers
получают его через `requireApiActor()` / `requireApiSession()` (401
`UNAUTHORIZED`), страницы — через `requirePageSession()`. Domain-команды и
repositories принимают только `Actor`; `{ userId: body.userId }` — ошибка
типов. Публичные DTO — `z.strictObject`, поэтому `userId`/`user_id` в body дают
400, а в query/headers не читаются.

**Ownership.** Для каждой персональной записи:

1. Repository фильтрует каждый select/update/delete в SQL через
   `ownedBy(table.userId, actor, …условия)` (`@lifeos/db`), т.е.
   `user_id = actor.userId AND …`. Чужая строка не загружается и не меняется.
2. Service пропускает результат через `requireOwned(actor, row)`
   (`requireFound` для записей, адресуемых самим actor): отсутствующая, чужая
   (и в fixture — некорректная по формату) запись — одинаковый `NotFoundError`.
3. HTTP-адаптер отображает `DomainError` в envelope: `NOT_FOUND` → **404**.
   Чужой ресурс **никогда не 403**: ответ на чужой и на несуществующий id
   неотличим и не содержит данных владельца. 403 `FORBIDDEN` остаётся для
   отказов политики, не раскрывающих существование ресурса (например,
   закрытая регистрация — 403 `SIGNUP_NOT_ALLOWED`).
4. Новые таблицы с персональными данными получают `user_id text NOT NULL
   REFERENCES "user"(id) ON DELETE CASCADE` (или проверяемую связь с
   владельцем) и индекс, начинающийся с `user_id`.

**Preferences.** `user.timezone` (IANA, default `UTC`) и `user.locale`
(BCP 47, default `ru`) — отдельная миграция `0002_user_preferences.sql`.
Better Auth о колонках не знает: он их не пишет (берутся DEFAULT), его
`validateSchema` допускает колонки с DEFAULT, а `/api/auth/update-user`
отбрасывает неизвестные поля, так что валидацию нельзя обойти. Читает и
меняет их только `UserPreferencesService` через repository с `ownedBy(user.id, actor)`;
HTTP — `GET/PATCH /api/v1/me/preferences` без id в URL.
Валидация (`@lifeos/contracts`): timezone — синтаксис IANA (UTC-offset вроде
`+01:00` отклоняется, хотя `Intl` его принимает) и `Intl.DateTimeFormat`;
написание берётся из `Intl.supportedValuesOf` без учёта регистра, валидные
имена вне списка (`Europe/Kyiv`) сохраняются как есть, а не заменяются ICU-алиасом.
Locale — `Intl.getCanonicalLocales` (каноническая форма) + поддержка
форматирования (`und`, `zz` отклоняются). Сервис валидирует вход сам, поэтому
будущие вызовы не из HTTP получат те же правила. Даты хранятся в UTC,
показываются через `Intl.DateTimeFormat(locale, { timeZone })` с fallback на
UTC, если ICU перестанет знать сохранённое значение; выходной DTO не
перевалидируется, чтобы обновление ICU не блокировало чтение настроек.

**Ошибки и слои бандла.** Next.js собирает RSC-страницы и Route Handlers в
разные слои, и в одном процессе бывает несколько копий `@lifeos/domain`.
Поэтому HTTP-маппер распознаёт доменные ошибки через `isDomainError()`
(неперечисляемый бренд `Symbol.for("@lifeos/domain/DomainError")` + проверка
кода), а не `instanceof`; domain-сервисы кэшируются на уровне модуля
(`server/core.ts`), не на `globalThis` — процессно общим остаётся только пул БД.
Дефект найден ручной проверкой production-сборки: после открытия `/settings`
невалидный PATCH давал 500 вместо 400.

**Зависимости пакетов.** `@lifeos/domain` → `@lifeos/contracts` (DTO-схемы),
`@lifeos/db` → `@lifeos/domain` (только типы `Actor` и портов repository; в
runtime-код db domain не попадает). Циклов нет; `domain` по-прежнему без
Next.js/React/`apps/*` и без SQL.

## Миграция и откат

`0002_user_preferences.sql` — только расширение: `ADD COLUMN … DEFAULT
constant NOT NULL` (PostgreSQL ≥ 11 не переписывает таблицу) и два грубых
CHECK по длине. Существующие строки получают defaults; sessions/accounts не
затрагиваются.

- **Откат приложения** (вернуть код LFS-201) не требует отката схемы: код
  LFS-201 и его конфигурация Better Auth не знают о колонках, вставки берут
  DEFAULT. Конфигурация Better Auth в LFS-202 не изменена, и весь набор тестов
  LFS-201 проходит на схеме с `0002`.
- **Откат схемы** — только новой forward-миграцией (удалить поля из
  `src/schema/auth.ts`, `pnpm db:generate`), после отката кода. Применённые SQL
  и journal не редактируются и не удаляются; ручных down-скриптов нет.

## Альтернативы

- `additionalFields` Better Auth с `input: false`: значения были бы в
  `session.user`, но связывали бы конфигурацию auth с профилем и требовали бы
  её откатывать вместе со схемой; выигрыш — один запрос на страницу. Отложено.
- `additionalFields` с `input: true` и Zod-validator: правку пришлось бы
  делать через Better Auth `/update-user` вне общего envelope и domain-сервиса.
- 403 для чужих ресурсов: раскрывает существование id; отклонено.
- Проверка владельца только после загрузки (без фильтра в SQL): чужие данные
  попадали бы в память процесса; отклонено — `requireOwned` лишь второй рубеж.
- Принимать UTC-offset или любой `Intl`-принимаемый идентификатор: offset
  игнорирует переход на летнее время; отклонено.

## Последствия

- Каждая будущая таблица/repository обязана использовать `ownedBy` + `requireOwned`
  и прогонять общий двухпользовательский контракт (см. «Проверка»).
- Страницы, которым нужны preferences, делают второй запрос к БД после сессии.
- Список часовых поясов и валидатор зависят от ICU Node.js (сейчас tz 2026e);
  браузер может отличаться, поэтому сервер авторитетен, а форма показывает
  серверный список.
- PATCH защищён от CSRF тем, что требует CORS preflight (CORS не настроен), и
  cookie `SameSite=Lax`; отдельный Origin-check для `/api/v1` не добавлялся.

## Проверка

- Unit: `packages/contracts/tests/contracts.test.ts` (timezone/locale, strict DTO),
  `packages/domain/tests/core.test.ts` (Actor brand через `@ts-expect-error`,
  `requireOwned`, сервис), `apps/web/tests/api.test.ts` (DomainError → envelope).
- Integration (PostgreSQL, два пользователя): `apps/web/tests/integration/ownership.test.ts`
  (test-only `ownership_fixture_note`: domain и HTTP 401/404, чужие сессии
  Better Auth) и `preferences.test.ts` (401, 400, `userId` в body/query/header,
  обход через `/update-user`, сохранение после повторного входа).
- Переиспользование: `tests/integration/support/auth-harness.ts` (изолированная
  schema + Better Auth + пользователи) и `support/ownership-contract.ts`
  (`expectDomainOwnership`, `expectHttpOwnership`). Новый ресурс передаёт свои
  команды/маршруты и данные владельца, которые не должны утечь.
- Миграции: `packages/db/tests/integration/migrations.test.ts` — чистая БД,
  upgrade Stage 1 и upgrade базы LFS-201 с пользователем/сессией/аккаунтом.
- Временная поломка `ownedBy` (фильтр без actor) роняет 8 integration-тестов.
