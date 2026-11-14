# @lifeos/web

Единое Next.js приложение для Web, будущего Telegram Mini App и HTTP API.
В LFS-103 настроены App Router, strict TypeScript, Tailwind 4 и shadcn/ui.

Здесь располагаются интерфейсы, HTTP-адаптеры, transport/auth и композиция.
Бизнес-правила принадлежат пакетам. Будущий URL Mini App — `/telegram/*`;
route group `(telegram)` сама по себе не добавляет сегмент URL.

## Маршруты и состояния

- `/`: Web layout, навигация якорями к шести будущим сферам и пустые карточки.
- `/telegram`: отдельный компактный layout и явная заглушка Mini App.
- `GET /api/health`: HTTP 200 с envelope `data/meta/errors`; `data` содержит
  `status`, `service`, `timestamp`, `meta` — request/correlation ID; `no-store`,
  без проверки БД. Другие методы, кроме автоматического HEAD, не добавлены.
- Неизвестные URL: 404 с возвратом на главную. Предусмотрены loading и
  безопасная error boundary без вывода внутренних ошибок или логирования payload.

Единственный root layout — `app/layout.tsx`. Route groups `(web)` и
`(telegram)` разделяют UX; публичный сегмент Mini App расположен в
`app/(telegram)/telegram/page.tsx`. Auth, Telegram SDK, реальные цели,
метрики, пользовательские данные и интеграции отсутствуют.

## Дизайн и компоненты

Токены цветов, типографики, отступов, скруглений и focus находятся в
`app/globals.css`. Шрифты системные, внешние font-запросы не требуются.
Настроены skip-link, семантические landmarks, клавиатурный focus,
адаптивные grid layouts и `prefers-reduced-motion`.

`components.json` использует shadcn `base-nova`, RSC и Tailwind CSS variables.
Card и Skeleton добавлены официальным CLI **4.23.0**:

```sh
pnpm --filter @lifeos/web exec shadcn add card skeleton --yes
```

Исходники компонентов хранятся в `components/ui`; EmptyState, Brand и
навигация — локальные presentation-компоненты. Список ссылок на сферы
нужен только для UI: доменный registry будет реализован на этапе 2.

## Команды

Из корня на Node.js 24.22.2 / pnpm 10.34.9:

```sh
pnpm dev
pnpm lint
pnpm typecheck
pnpm build
pnpm --filter @lifeos/web start
```

В PowerShell при запрете `.ps1` используйте `pnpm.cmd`. Root `dev` запускает
только Web на `http://127.0.0.1:3000`; worker автоматически не запускается.
`next typegen` подготавливает route types перед `tsc`; `next-env.d.ts`,
`.next` и `*.tsbuildinfo` генерируются и игнорируются Git. Web включает
ES2024 lib для совместимости с типами Next 16.4.5, сохраняя strict.
Рекомендованный Next `skipLibCheck` исключает конфликт ambient declarations
между `.next/types` и `.next/dev/types` после чередования dev/build.
Исходные `.ts`/`.tsx` и сгенерированный route validator проверяются;
общий tsconfig пакетов этим флагом не изменён.
Общий ESLint config экспортируется из `@lifeos/config/eslint/base`, Next
plugin подключён локально. Stable `jiti` загружает TypeScript-конфиги ESLint.

В LFS-106 `test` запускает Vitest: env проверяется отдельно в config,
здесь проверяются HTTP envelopes, DTO/JSON validation, 200/400/404/500,
все коды mapper, безопасные логи и перенос context в job DTO.

`server/api-route.ts` — тонкий HTTP-helper, `server/api-error.ts` — фиксированная
карта ошибок. `scripts/run-next.ts` проверяет env до загрузки Next CLI;
`instrumentation.ts` дополнительно вызывает server-only validation, пропуская
build phase. Прямой `next start` может напечатать Ready до окончания hook,
поэтому используйте workspace scripts. Dev/start загружают root
`.env` средствами Node и требуют валидный `DATABASE_URL`, не подключаясь к БД.
Импорт env в client components запрещён. Подробности:
[API-контракт](../../docs/api/contracts.md).

## Проверки LFS-103

На Windows x64 / Node 24.22.2 проверены lint, typecheck, production build и
запуск root `dev`. HTTP-проверки подтвердили 200 для `/`, `/telegram`,
`/api/health`, безопасную схему health с актуальным ISO timestamp, 405 для
POST health и 404 для неизвестного URL / пути с названием route group.

Визуальная проверка браузера, ручной keyboard smoke и мобильный скриншот
**NOT RUN**: Computer Use остановлен защитой, поскольку текущий URL Chrome
не удалось надёжно определить. Адаптивная разметка и focus реализованы,
но визуальная приёмка остаётся ручной: открыть три URL, проверить ширину
360–390 px, Tab/Shift+Tab, skip-link, ссылки на сферы и возврат из Telegram.

Установка и ограничения: [корневой README](../../README.md#окружение-lfs-102).

## Handoff LFS-109

HTTP/production smoke повторно прошёл в полной verify chain. Визуальная,
keyboard и mobile приёмка остаётся NOT RUN: новая попытка Browser Use вернула
`The browser access host is unavailable`, browser inventory пуст. Эти ограничения
не заменяются HTTP 200. Layout/URL decision: [ADR-004](../../docs/adr/004-next-routing.md),
актуальная приёмка: [Stage 1](../../docs/tasks/STAGE-01-ACCEPTANCE.md).
