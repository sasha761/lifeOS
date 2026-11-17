# ADR-005 — Аутентификация: Better Auth, закрытая регистрация, сброс пароля

- **Статус:** Accepted
- **Дата:** 2026-11-14
- **Связанные задачи:** LFS-201; дальше LFS-202 (профиль, ownership); [ADR-001](001-stack.md), [ADR-003](003-runtime-boundaries.md)

## Контекст

Stage 2 начинается с личного пилота: одна учётная запись, но с server-side
ownership, как в будущем SaaS. Нужны регистрация только для приглашённых email,
вход/выход, восстановление доступа и защищённые маршруты. Master Plan v0.4 и
ADR-001 закрепили Better Auth 1.7.18 и Drizzle adapter. Реальное поведение
версии сверено по установленным типам и исходникам `better-auth@1.7.18`.

## Решение

**Компоновка.** `createAuth()` в `apps/web/server/auth/create-auth.ts` не зависит
от Next.js и собирается одинаково в Web и интеграционных тестах. `getAuth()`
лениво создаёт один экземпляр на процесс из проверенного env — во время
`next build` env и БД не нужны. Better Auth обслуживает `/api/auth/*` (свой JSON),
собственные API `/api/v1/*` используют общий envelope.

**Схема.** Четыре core-таблицы `user`, `session`, `account`, `verification`
(миграция `0001_better_auth.sql`) повторяют официальный Drizzle-генератор
Better Auth: text id, snake_case колонки, `timestamp` без зоны (Better Auth
пишет значения из JS в UTC), FK `ON DELETE cascade`, индексы `<model>_<field>_idx`.
FK в SQL не квалифицированы `public`, чтобы изолированные test schemas ссылались
на свою `user`. Runtime-проверка схемы адаптера (`validateSchema`) включена.
Новые поля пользователя — отдельной миграцией (LFS-202).

**Закрытая регистрация.** `user.validateUserInfo` вызывается Better Auth перед
каждым созданием пользователя; правило — `createSignupPolicy()` в
`@lifeos/domain` (trim + регистронезависимое сравнение со списком
`AUTH_SIGNUP_ALLOWLIST`). Вне списка — 403 `SIGNUP_NOT_ALLOWED`, пользователь
не создаётся. Вход существующих пользователей список не проверяет. Пустой список
закрывает регистрацию полностью. Это ограничение пилота, не модель авторизации.

**Пароли и сессии.** Пароль — scrypt-хэш Better Auth в `account.password`,
длина 8–128 (общие константы в `@lifeos/contracts`). Сессии хранятся в БД;
cookie `lifeos.session_token` — HttpOnly, SameSite=Lax, Secure и префикс
`__Secure-` при https `BETTER_AUTH_URL`. Срок — абсолютные 7 дней
(`disableSessionRefresh`): Server Components не могут переписать cookie, а
продление только в БД расходилось бы с её сроком. Cookie cache выключен,
поэтому logout и сброс пароля действуют сразу.

**Охрана маршрутов.** Авторитетная проверка — `requirePageUser()` на каждой
защищённой странице (`/dashboard`, `/goals`) и `requireApiUser()` в API
(401 `UNAUTHORIZED`). Actor берётся только из проверенной cookie-сессии, никогда
из body/query/headers. `proxy.ts` (Next.js 16 Proxy) лишь проверяет наличие cookie
без БД и отдаёт гостю 307 до начала стриминга; при поддельной cookie страница
всё равно отказывает.

**Восстановление доступа.** Токен — 24 случайных символа, 60 минут, одноразовый
(атомарный consume). `verification.storeIdentifier = "hashed"`: в БД хранится
SHA-256 от `reset-password:<token>`, не сам токен. После сброса все сессии
пользователя отзываются. Ссылка `/api/auth/reset-password/<token>` проверяет
токен и ведёт на `/auth/reset-password?token=…` (страница с `no-referrer`).

**Доставка писем.** `MailSender` с двумя транспортами: `outbox` — явный
dev/test-транспорт (JSON-файл на письмо в игнорируемой папке), запрещён env-
валидацией при `NODE_ENV=production`; `smtp` — реальная доставка любому
SMTP-провайдеру через nodemailer 10.3.1 (`SMTP_URL`). Ошибки транспорта
превращаются в `MailDeliveryError` без адресов, ссылок и credentials.
Better Auth 1.7.18 ждёт `sendResetPassword`, но ловит и только логирует его
ошибки, отвечая «письмо отправлено». Поэтому сбой помечается в request state
(`defineRequestState` из `@better-auth/core/context`), а after-hook на
`/request-password-reset` возвращает 503 `EMAIL_DELIVERY_FAILED`.

**Защита от перебора.** Встроенный rate limit Better Auth (только production,
in-memory): вход/регистрация — 3 запроса за 10 с, запрос сброса — 3 за 60 с.
Формы ходят через Better Auth client по HTTP (`/api/auth/*`), поэтому лимиты и
проверки Origin/CSRF применяются; server actions с `auth.api.*` их бы обходили.

**Приватность.** Телеметрия Better Auth выключена явно, логгер — `warn`
(его сообщения уровня warn/error в используемых маршрутах не подставляют email,
токены и пароли). Пароли, токены и ссылки сброса не логируются — это проверяют
тесты.

## Альтернативы

- Server actions с `auth.api.*` — обходят rate limit Better Auth; отклонено.
- Хранение reset-токенов как есть (default Better Auth) — противоречит LFS-201.
- Mailpit/SMTP-catcher как обязательный dev-сервис — лишняя инфраструктура;
  SMTP-путь проверяется тестовым SMTP-сервером в unit-тестах.
- Собственная реализация auth — противоречит ADR-001.
- Скользящие сессии — требуют обновления cookie вне RSC; отложено.

## Последствия и ограничения

- Rate limit хранится в памяти одного процесса; при нескольких инстансах нужен
  общий storage (решение до публичного SaaS).
- Регистрация существующего allowlisted email отвечает 422 (существование
  видно только для адресов из списка). Во время сбоя доставки запрос сброса
  для существующего email даёт 503, для неизвестного — 200: так требование
  «не сообщать об отправке, если её нет» реализовано ценой этого сигнала.
- Неотправленный при сбое токен остаётся в `verification` хэшем до истечения.
- Подтверждение email не требуется: регистрация закрыта списком.
- Реальная доставка через внешнего SMTP-провайдера проверяется при деплое (Stage 8).

## Проверка

`pnpm verify` (lint, typecheck, unit, test migrations, PostgreSQL integration,
build, smoke) — PASS 2026-11-14. Интеграционные тесты Better Auth + PostgreSQL:
`apps/web/tests/integration/auth.test.ts`; миграции и upgrade Stage 1:
`packages/db/tests/integration/migrations.test.ts`. Ручной HTTP-прогон
production-сборки и ограничения — [LFS-201](../tasks/LFS-201.md).
