# Stage 2 — Acceptance Checklist

> Заполняется Codex при выполнении `LFS-209`. Ставит галочки **только** после проверок; для каждого пункта прикладывает команду/тест или наблюдаемый результат.

Заполнено в LFS-209, 2026-11-17. Пути тестов даны от корня репозитория; `web/…` — это `apps/web/tests/…`,
`e2e` — Playwright (`pnpm test:ui`, desktop 1280×900 и mobile 390×844), остальное входит в `pnpm verify`.

## Функции

- [x] Allowed email может зарегистрироваться; email вне allowlist не может; существующие пользователи входят и выходят.
  - `web/integration/auth.test.ts`: «registers an allowlisted email…», «rejects an email outside the allowlist…», «does not block sign-in of existing users…», «invalidates the server-side session on logout…».
  - e2e `stage2-acceptance.spec.ts`, первый сценарий: вход через настоящую форму, выход кнопкой «Выйти»; старый cookie после выхода получает 401.
- [x] Пользователь может сбросить пароль через реально настроенный dev email transport; механика продакшн-доставки документирована.
  - `web/integration/auth.test.ts`, блок «password reset»: письмо через dev outbox, одноразовый токен (в БД хранится только хеш), отзыв сессий, истёкший токен, неизвестный email, ошибка доставки.
  - `web/mail.test.ts`: SMTP-транспорт на тестовом SMTP-сервере.
  - Продакшн-доставка описана в `docs/adr/005-auth.md` и `docs/api/contracts.md` (`MAIL_TRANSPORT=smtp`, `SMTP_URL`; outbox при `NODE_ENV=production` запрещён).
  - Ограничение: реальный внешний SMTP-провайдер проверяется при деплое (Stage 8, ADR-005); в браузере сброс не прогоняется, см. «Open issues».
- [x] Неавторизованные запросы к целям возвращают 401; UI защищён.
  - `web/integration/goals-api.test.ts` «guards all eight endpoints…».
  - `web/integration/auth.test.ts` «returns 401 in the common envelope without a session».
  - `web/integration/dashboard.test.ts` «requires a verified session…», `web/integration/preferences.test.ts` «reject guests with 401…».
  - `scripts/build-smoke.ts`: защищённые страницы отвечают 307 на `/auth/sign-in?next=…`, поддельный cookie не пускает, `/api/v1/me` → 401.
  - e2e: `goals.spec.ts` «guest guards…»; `stage2-acceptance.spec.ts` — `/goals` после выхода снова ведёт на вход.
- [x] Всего 6 сфер (`languages`, `finance`, `work`, `projects`, `skills`, `health`), нет ложных показателей.
  - `packages/domain/tests/domains.test.ts`, `packages/contracts/tests/domains.test.ts`: ровно 6 ключей, нет фиктивных метрик, седьмая сфера не принимается.
  - `web/integration/dashboard.test.ts` «shows all six spheres for a user without data and invents nothing».
  - e2e `dashboard.spec.ts`: пустой Dashboard — 6 карточек «Нет целей», ни одного `%` и progressbar.
  - Публичные `/`, `/telegram`, `/domains/*` проверены по коду: данные только из реестра сфер, цифр нет.
- [x] В любой сфере создаётся ручная цель; `computed` до интеграции metric provider недоступен.
  - `web/integration/goals.test.ts` «creates manual goals in all six spheres…».
  - e2e `stage2-acceptance.spec.ts`: через форму создаётся цель в каждой из 6 сфер и попадает в карточку своей сферы.
  - `computed` отклоняется контрактом (`packages/contracts/tests/goals.test.ts`), CHECK в SQL (`web/integration/goals.test.ts`, «a computed goal») и HTTP 400 (`goals-api.test.ts` «rejects invalid units…»).
- [x] При отсутствии измерения Dashboard показывает «Недостаточно данных», а не вымышленный 0%.
  - `packages/domain/tests/goal-progress.test.ts` «distinguishes missing measurements from an actual measured zero…».
  - e2e `stage2-acceptance.spec.ts`: после удаления единственного измерения цель и Dashboard показывают «Недостаточно данных» без процента и полосы; API — `current: null`, `insufficient_data`.
- [x] Finance: baseline 0, target 50000 NOK, current 12000 ⇒ 24%.
  - `goal-progress.test.ts` (increase 0 → 50000 при 12000 = 24), `goals-api.test.ts` «…computes savings/debt…».
  - e2e `goals.spec.ts`, `dashboard.spec.ts`, `stage2-acceptance.spec.ts`: 24% на странице цели и на Dashboard.
- [x] Decrease: долг baseline 100000, target 0, current 80000 ⇒ 20%.
  - `goal-progress.test.ts` (decrease 100000 → 0 при 80000 = 20), `goals-api.test.ts` «…computes savings/debt…».
  - e2e `stage2-acceptance.spec.ts`: 20% на экране, совпадает с `GET /api/v1/goals/:id`.
- [x] При current > target UI показывает 100% (clamp), но actual current не теряется.
  - `goal-progress.test.ts` (10 → 20 при 30 = 100; «never mutates current»), `goals-api.test.ts` «…clamps only the display…».
  - e2e `stage2-acceptance.spec.ts`: 100% и «60,000 NOK из 50,000 NOK» на странице цели и на Dashboard, API — `current: "60000"`, `methodology.clamped: true`.
- [x] baseline == target обработан без division by zero и объяснён методологически.
  - Создание такой цели отклоняется (ADR-007 «Определение»; `goals-api.test.ts` — 400 на `baseline = target = 0`).
  - Защитный расчёт при неположительном знаменателе возвращает `invalid_definition` / «Некорректное определение цели» без деления на ноль (`goal-progress.test.ts` «handles degenerate and reversed definitions…»; ADR-010, `docs/api/contracts.md`).
- [x] Добавить/изменить/удалить измерение можно через UI, Dashboard актуализируется.
  - e2e `stage2-acceptance.spec.ts`: добавление (24%), правка (30%), удаление («Недостаточно данных»); после каждого шага Dashboard и «Последние действия» обновлены.
  - `web/integration/dashboard.test.ts` «…shows the same progress as goal details after every change».
- [x] `measured_at` определяет порядок; backdated ввод не искажает текущую величину.
  - `web/integration/goal-measurements.test.ts` «uses measured time rather than insertion time…», «breaks equal measured times by created_at and id…».
  - `goals-api.test.ts` «…keeps backdated inserts from changing current».
  - e2e `stage2-acceptance.spec.ts`: измерение позавчерашней датой, введённое позже, стоит вторым в истории; current и 20% не меняются.
- [x] Audit events пишутся вместе с доменной операцией в транзакции, rollback проверен.
  - `web/integration/activity-events.test.ts` «rolls back create, edit and archive when the audit INSERT fails…», «rolls back an already inserted event and goal…».
  - `goal-measurements.test.ts` «rolls back create/edit/delete and current when %s insertion fails».
  - `goals-api.test.ts` «rolls back HTTP writes on receipt failure…».
- [x] Идемпотентность повторного POST/других retry-safe операций подтверждена тестами.
  - `goals-api.test.ts` «replays every write endpoint without duplicate effects and conflicts on changed inputs».
  - `activity-events.test.ts` «serializes simultaneous duplicates…», `goal-measurements.test.ts` «serializes concurrent create, update and delete retries…».
  - Stage 1 `packages/db/tests/integration/atomicity.test.ts`.
  - e2e `goals.spec.ts`: потерянный ответ после записи → повтор с тем же ключом, одна запись.

## Security / качество

- [x] Есть тесты минимум на двух пользователей для чужих goals/measurements/events.
  - `goals.test.ts` «reuses the two-user ownership contract…», `goal-measurements.test.ts` «enforces the reusable two-user contract…».
  - `goals-api.test.ts` «enforces HTTP ownership for goals and measurements…».
  - `activity-events.test.ts` «scopes the same key to separate owners and hides foreign events», «refuses a foreign or forged event…».
  - `dashboard.test.ts` «aggregates two users separately…», `ownership.test.ts`.
  - e2e: чужая цель по URL не открывается (`goals.spec.ts`), чужой Dashboard пуст (`dashboard.spec.ts`).
- [x] Body `userId` не может подменить серверный actor.
  - `ownership.test.ts` «does not let a userId in the body or query re-target a mutation…», `preferences.test.ts` (body, query, header, Better Auth update-user).
  - `goals-api.test.ts`: POST цели и измерения с `user_id` → 400; новый тест LFS-209 «refuses a body user id on goal and measurement edits…» — PATCH цели, архивирования и измерения с `user_id`/`userId` от владельца и от чужого пользователя → 400 `VALIDATION_ERROR`, данные не изменились.
  - Сервисный уровень: `goals.test.ts`, `goal-measurements.test.ts` «rejects forged fields…».
- [x] Известные ошибки валидации и конфликтов используют общий API envelope.
  - `goals-api.test.ts`: `VALIDATION_ERROR` (400), `CONFLICT` при повторе ключа с другим телом, безопасный 500, `no-store`.
  - `web/api.test.ts` «HTTP boundary»; `auth.test.ts` — 401 в общем envelope.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` (или задокументированные скрипты) завершены успешно; отказ не замаскирован.
  - `pnpm verify` и `pnpm test:ui` — PASS, числа в разделе «Отчёт».
  - Hosted CI (`pnpm verify` на Linux с PostgreSQL 18.6): PASS на PR #2 (LFS-212) и PR #3 (LFS-209), ссылки в разделе «Отчёт».
- [x] Миграции применяются к чистой БД и upgrade существующей Stage 1 базы не стирает данные.
  - `packages/db/tests/integration/migrations.test.ts`: чистая схема и повторное применение; upgrade Stage 1 → 0005 с сохранением данных; поэтапные upgrade LFS-201, 202, 205, 210 с сохранением пользователей, сессий, целей, receipts и событий.
  - `test-migrations-cli.test.ts`.
- [x] Worker/pg-boss и `/api/health` продолжают работать.
  - `apps/worker/tests/integration/worker.test.ts` (CLI producer, retry/backoff, SIGINT drain, ошибки конфигурации и БД).
  - `atomicity.test.ts` (enqueue в транзакции).
  - `web/api.test.ts` и `scripts/build-smoke.ts` (production health 200 с PostgreSQL).
- [x] UI проверен на мобильном экране и с клавиатурой.
  - Все e2e выполняются на 390×844 (touch) и 1280×900; в основных сценариях проверяется отсутствие горизонтальной прокрутки.
  - Клавиатура: `goals.spec.ts` «keyboard modal traps Tab and restores focus after Escape», диалог «Новая цель» (Escape, возврат фокуса).
  - Ручная проверка клавиатуры, фокуса и контраста — LFS-212.
- [x] Реальных Telegram/AI/банковских подключений в этом этапе нет.
  - В `package.json` приложений и пакетов нет SDK Telegram, AI-провайдеров или банков.
  - `/telegram` — статическая заглушка «появится позже»; Finance — только ручные цели.

## Отчёт / решение

- Date / commit: 2026-11-17, ветка `lfs-209-stage2-acceptance`: `95317f4` (LFS-209) поверх `26b5b7c` (LFS-212), PR #3 и PR #2.
- Test commands and results:
  - `pnpm db:test:up` — PASS.
  - `pnpm verify` — PASS: frozen install, lint, typecheck, 524 unit, test migrations, 140 PostgreSQL integration (20 db + 115 web + 5 worker; было 139), сборки Web/worker, build smoke.
  - `pnpm test:ui` — PASS: 22 Playwright (11 сценариев × desktop/mobile), было 16.
  - `git diff --check` — PASS.
  - Hosted CI: PR #2 (LFS-212) — PASS, [run 44170722668](https://github.com/sasha761/lifeOS/actions/runs/44170722668); PR #3 (LFS-209, коммит `95317f4`) — PASS, [run 44172942107](https://github.com/sasha761/lifeOS/actions/runs/44172942107).
- Open issues:
  - Playwright в hosted workflow не входит, `test:ui` проверяется только локально.
  - Сброс пароля в браузере не прогоняется: production-сборка запрещает outbox, а фикстура использует недоступный SMTP. Сброс покрыт integration-тестами через outbox и SMTP-тестом транспорта; реальная доставка — Stage 8.
  - Лимит попыток входа (rate limit) в e2e не проверяется: production-значения Better Auth, логика — LFS-201.
  - Цели и действия на странице сферы — отдельная задача (из LFS-212).
- Migration notes: в LFS-209 миграций нет; история `0000`–`0005` без изменений. Main DB в этой задаче не трогалась; тестовые схемы создаются и удаляются раннерами.
- Ready for Stage 3: **yes — рекомендация исполнителя, окончательное решение за владельцем.** Все пункты чек-листа подтверждены тестами локально и hosted CI. До старта Stage 3 нужно влить PR #2 (LFS-212) и PR #3 (LFS-209) в `main`.
