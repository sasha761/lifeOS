# ADR-001 — Версии и совместимость стека Foundation

- **Статус:** Accepted
- **Дата:** 2026-11-08
- **Связанные задачи:** LFS-102, LFS-103, LFS-104, LFS-105, LFS-106, LFS-107, LFS-108, LFS-109; развитие каркаса LFS-101

## Контекст

LifeOS использует единый TypeScript-стек из Master Plan v0.4. До настройки
приложений нужны воспроизводимые зависимости и общий Node.js runtime для Web
и worker. Проверены официальные npm dist-tags, `engines`, `peerDependencies`
и документация на 2026-11-08. Номер без prerelease-суффикса сам по себе не
означает совместимость: учитываются требования всего выбранного набора.

## Решение

Node.js **24.22.2 LTS** закреплён в `.nvmrc`; root `engines.node` допускает
`>=24.22.2 <25`. Для воспроизводимых проверок используется точный patch из
`.nvmrc`, а не произвольная версия диапазона. **pnpm 10.34.9** закреплён в
`packageManager` и `engines.pnpm`. `.npmrc` включает `engine-strict`,
`strict-peer-dependencies` и `save-exact`. Прямые внешние зависимости имеют
точные версии, транзитивные версии и integrity фиксирует `pnpm-lock.yaml`.
Store хранится локально в игнорируемой `.pnpm-store`, без изменения
пользовательской глобальной конфигурации.
Lifecycle scripts разрешены только для native-инструментов `esbuild` и
`sharp` в `pnpm-workspace.yaml`; общий запуск скриптов зависимостей не включён.

Таблица фиксирует выбранные версии. «Установлен» означает наличие пакета в
manifest и lockfile, но не готовую функциональность. «Позже» означает решение
для будущей задачи: такой пакет сейчас не установлен и в lockfile отсутствует.
Если не указано иное, источники в таблице проверены **2026-11-08**.

| Компонент | Версия | Зачем | Где используется | Источник/дата проверки |
|---|---|---|---|---|
| Node.js | 24.22.2 LTS | Общий runtime, включая будущий FSRS | Web, worker, tooling; проверен portable Windows x64 | [Релизы](https://nodejs.org/dist/index.json), [LTS](https://nodejs.org/en/about/previous-releases); 2026-11-08 |
| pnpm | 10.34.9 | Workspace, lockfile, строгие engines/peers | Package manager; установлен | [Metadata](https://registry.npmjs.org/pnpm/10.34.9), [настройки 10.x](https://pnpm.io/10.x/settings); 2026-11-08 |
| Turborepo | 2.11.10 | Граф задач monorepo | Root devDependency; установлен | [Metadata](https://registry.npmjs.org/turbo/2.11.10), [конфигурация](https://turborepo.dev/docs/reference/configuration); 2026-11-08 |
| Next.js | 16.4.5 | Один App Router для Web/Mini App/API | `apps/web`; Web shell настроен в LFS-103 | [Metadata](https://registry.npmjs.org/next/16.4.5), [установка](https://nextjs.org/docs/app/getting-started/installation); 2026-11-08 |
| React / React DOM | 19.3.1 / 19.3.1 | UI runtime | `apps/web`; установлены | [React](https://registry.npmjs.org/react/19.3.1), [React DOM peers](https://registry.npmjs.org/react-dom/19.3.1); 2026-11-08 |
| TypeScript | 6.0.3 | Strict типизация с поддержкой lint parser | Root tooling; установлен | [Metadata](https://registry.npmjs.org/typescript/6.0.3), [диапазон parser](https://typescript-eslint.io/users/dependency-versions/); 2026-11-08 |
| ESLint | 10.14.0 | Поддерживаемый flat-config linter | Root tooling и `packages/config`; Web/config lint настроен в LFS-103 | [Metadata](https://registry.npmjs.org/eslint/10.14.0), [поддержка](https://eslint.org/version-support/); 2026-11-08 |
| typescript-eslint | 8.72.1 | TypeScript parser и правила | Root tooling; установлен | [Metadata](https://registry.npmjs.org/typescript-eslint/8.72.1), [совместимость](https://typescript-eslint.io/users/dependency-versions/); 2026-11-08 |
| Next ESLint plugin | 16.4.5 | Next-specific правила без несовместимых агрегированных presets | `apps/web`, `@next/eslint-plugin-next`; установлен | [Metadata](https://registry.npmjs.org/@next/eslint-plugin-next/16.4.5), [прямое подключение](https://nextjs.org/docs/app/api-reference/config/eslint#using-the-plugin-directly); 2026-11-08 |
| Tailwind CSS / PostCSS adapter | 4.3.5 / 4.3.5 | Стили Web | `apps/web`; установлены, настройка LFS-103 | [CSS](https://registry.npmjs.org/tailwindcss/4.3.5), [adapter](https://registry.npmjs.org/@tailwindcss/postcss/4.3.5), [PostCSS](https://tailwindcss.com/docs/installation/using-postcss); 2026-11-08 |
| PostCSS | 8.5.32 | Обработка Tailwind CSS | `apps/web` tooling; установлен | [Metadata](https://registry.npmjs.org/postcss/8.5.32); 2026-11-08 |
| shadcn CLI | 4.23.0 | Добавление исходников UI-компонентов | `apps/web` devDependency; в LFS-103 добавлены Card и Skeleton, style base-nova | [Metadata](https://registry.npmjs.org/shadcn/4.23.0), [Next.js](https://ui.shadcn.com/docs/installation/next); 2026-11-08 |
| cn | 0.5.2 | Объединение CSS classes в shadcn/ui | `apps/web`; добавлен в LFS-103 | [Metadata](https://registry.npmjs.org/cn/0.5.2), [manual setup](https://ui.shadcn.com/docs/installation/manual); 2026-11-08 |
| lucide-react | 1.70.0 | Векторные UI-иконки | `apps/web`; добавлен в LFS-103 | [Metadata/React peers](https://registry.npmjs.org/lucide-react/1.70.0); 2026-11-08 |
| tw-animate-css | 1.4.0 | CSS utilities shadcn; reduced-motion обрабатывается в теме | `apps/web` devDependency; добавлен в LFS-103 | [Metadata](https://registry.npmjs.org/tw-animate-css/1.4.0), [manual setup](https://ui.shadcn.com/docs/installation/manual); 2026-11-08 |
| jiti | 2.7.0 | Загрузка ESLint TypeScript configs без experimental flags | Root devDependency; закреплён явно в LFS-103 | [Metadata](https://registry.npmjs.org/jiti/2.7.0), [ESLint TS config](https://eslint.org/docs/latest/use/configure/configuration-files#typescript-configuration-files); 2026-11-08 |
| PostgreSQL | 18.6-bookworm | Общее хранилище приложения и очереди | Compose LFS-104; основной и отдельный тестовый экземпляры | [Stable/support](https://www.postgresql.org/support/versioning/), [официальный image](https://hub.docker.com/_/postgres); 2026-11-08 |
| Drizzle ORM / Kit | 0.45.4 / 0.31.11 | SQL schema, repositories, migrations | `packages/db`; client и migrations настроены в LFS-104 | [ORM](https://registry.npmjs.org/drizzle-orm/0.45.4), [Kit](https://registry.npmjs.org/drizzle-kit/0.31.11), [PostgreSQL drivers](https://orm.drizzle.team/docs/get-started-postgresql); 2026-11-08 |
| node-postgres (`pg`) | 8.23.1 | Общий PostgreSQL driver для Drizzle и pg-boss | `packages/db`, транзитивно worker; установлен | [Metadata](https://registry.npmjs.org/pg/8.23.1), [Drizzle](https://orm.drizzle.team/docs/get-started-postgresql); 2026-11-08 |
| pg-boss | 12.38.1 | Фоновые задания в PostgreSQL | `apps/worker`; отдельный runtime и demo CLI настроены в LFS-105 | [Metadata](https://registry.npmjs.org/pg-boss/12.38.1), [требования](https://pgboss.io/), [transaction adapters](https://pgboss.io/api/adapters); metadata 2026-11-08, runtime API 2026-11-10 |
| Zod | 4.6.7 | DTO и валидация неизвестных входов | `packages/contracts`; установлен, схемы LFS-106 | [Metadata](https://registry.npmjs.org/zod/4.6.7), [документация](https://zod.dev/); 2026-11-08 |
| server-only | 0.0.1 | Запрет импорта серверного env в client graph Next.js | `apps/web`; добавлен в LFS-106 | [Metadata](https://registry.npmjs.org/server-only/0.0.1), [Next.js server-only](https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning); 2026-11-12 |
| Vitest / Vite | 5.1.0 / 8.3.6 | Unit/integration runner и его peer | Root tooling; установлены, тесты в следующих задачах | [Vitest](https://registry.npmjs.org/vitest/5.1.0), [Vite](https://registry.npmjs.org/vite/8.3.6), [guide](https://vitest.dev/guide/); 2026-11-08 |
| Playwright Test | 1.65.0 | Будущие E2E/smoke-проверки | Root tooling; установлен, браузеры не загружались | [Metadata](https://registry.npmjs.org/@playwright/test/1.65.0), [системные требования](https://playwright.dev/docs/intro); 2026-11-08 |
| Better Auth / Drizzle adapter | 1.7.18 / 1.7.18 | Будущая авторизация | Позже, этап 2; не установлены | [Auth peers](https://registry.npmjs.org/better-auth/1.7.18), [adapter peers](https://registry.npmjs.org/@better-auth/drizzle-adapter/1.7.18), [docs](https://better-auth.com/docs/adapters/drizzle); 2026-11-08 |
| grammY | 1.46.0 | Будущий Telegram-бот | Позже, этап 3; не установлен | [Metadata](https://registry.npmjs.org/grammy/1.46.0), [guide](https://grammy.dev/guide/getting-started); 2026-11-08 |
| AI SDK (`ai`) | 7.0.165 | Будущий общий AI runtime | Позже, этап 3; не установлен | [Metadata](https://registry.npmjs.org/ai/7.0.165), [Node.js guide](https://ai-sdk.dev/docs/getting-started/nodejs); 2026-11-08 |
| ts-fsrs | 6.0.0 | Будущий планировщик повторений | Позже, этап 5; не установлен | [Metadata/engines](https://registry.npmjs.org/ts-fsrs/6.0.0), [репозиторий](https://github.com/open-spaced-repetition/ts-fsrs); 2026-11-08 |
| Node / React / React DOM / pg types | 24.19.2 / 19.3.0 / 19.3.0 / 8.23.1 | Типы выбранных runtime-веток | Root / Web / DB devDependencies; установлены | [Node](https://registry.npmjs.org/@types/node/24.19.2), [React](https://registry.npmjs.org/@types/react/19.3.0), [DOM](https://registry.npmjs.org/@types/react-dom/19.3.0), [pg](https://registry.npmjs.org/@types/pg/8.23.1); 2026-11-08 |

**Better Auth, grammY, AI SDK и ts-fsrs будут реализованы позже.** Сейчас
выбраны версии и проверены объявленные требования, но нет их конфигурации,
auth schema, Telegram webhook, AI provider, API-вызовов или FSRS state.
Перед их фактической установкой нужно повторно проверить совместимость и
безопасность точного релиза и явно обновить этот ADR при смене версии.

shadcn/ui распространяет исходники компонентов, поэтому фиксируется версия
CLI, а исходники добавленных компонентов хранятся в Git. В LFS-102 CLI не
запускался; в LFS-103 выполнено `shadcn add card skeleton --yes` с
`components.json` и закреплённым CLI 4.23.0. В LFS-104 закреплён образ:

```text
postgres:18.6-bookworm@sha256:f1ea2a1a4fb7b68d4836be1fdcb8a6466a89b072158bf9d97663600538c294c5
```

Это multi-platform manifest digest официального Docker Registry,
проверенный 2026-11-08. PGDATA PostgreSQL 18 расположен в
`/var/lib/postgresql/18/docker`; persistent volume монтируется в
`/var/lib/postgresql`, согласно документации образа.

## Совместимость и осознанные ограничения

В LFS-108 версии runtime/npm-пакетов сохранены. GitHub Actions закреплены
полными commit SHA в workflow: checkout 6.1.0
(`d23441a48e516b6c34aea4fa41551a30e30af803`), setup-node 6.5.0
(`249970729cb0ef3589644e2896645e5dc5ba9c38`), pnpm/action-setup 6.1.1
(`73e46992e05b19abd31f2f3c20e0e7370d762115`). Refs и action metadata проверены
2026-11-12 в официальных репозиториях; все три используют Node 24 для Actions.
Node/pnpm приложения по-прежнему берутся из `.nvmrc` / `packageManager`.
PostgreSQL service использует исходный 18.6 image digest, cache — только pnpm
store по lockfile. Решение и воспроизведение: [CI](../CI.md).

В LFS-107 `packages/db` получил test-only devDependencies `pg-boss` 12.38.1,
Zod 4.6.7 и `@lifeos/contracts` workspace для PostgreSQL atomicity fixture.
Существующие версии и production dependencies не изменены. Transaction adapter
проверен на реальном PostgreSQL; [доказательство](002-queue-atomicity.md).

- Next.js 16.4.5 требует Node `>=20.9.0`; pg-boss 12.38.1 — `>=22.12.0`;
  AI SDK 7 — `>=22`; будущий ts-fsrs 6 — **`>=24.0.0`**. Общая ветка 24
  удовлетворяет всем этим требованиям. pg-boss требует PostgreSQL >=13,
  выбран PostgreSQL 18.6. Драйвер Drizzle — `node-postgres`, не отдельный
  несовместимый driver для очереди; решение описано в [ADR-002](002-postgres-queue.md).
- В официальном Node index уже есть LTS 26.13.0. Выбрана поддерживаемая
  LTS-ветка 24: она продолжает runtime LFS-101 и удовлетворяет FSRS без
  перехода на новый major. Patch обновлён с 24.22.1 до 24.22.2.
- Текущий pnpm stable — 12.18.0 (native executable). Сохранена ветка 10 с
  обновлением **10.33.4 → 10.34.9**, чтобы не менять одновременно формат
  tooling/runtime доставки и проверенный lockfile v9 каркаса.
- Текущий TypeScript stable — 7.0.2. `typescript-eslint` 8.72.1 принимает
  только `>=4.8.4 <6.1.0`, поэтому выбран stable **6.0.3**. Версия 7 и
  отключение предупреждений parser не используются. Корневой tsconfig
  явно подключает `types: ["node"]` для Node-скриптов; общий config остаётся
  независимым от runtime и не добавляет Node globals во все пакеты.
- ESLint **10.14.0** поддерживается upstream. ESLint 9.39.5 уже EOL, поэтому
  он отклонён. `eslint-config-next` 16.4.5 формально допускает ESLint >=9,
  но его `eslint-plugin-react` 7.37.5, `eslint-plugin-import` 2.32.0 и
  `eslint-plugin-jsx-a11y` 6.10.2 не объявляют peer для ESLint 10. Выбран
  официальный `@next/eslint-plugin-next` напрямую вместе с
  `typescript-eslint`. Агрегированный preset не установлен; peer-проверки
  не ослаблены. Это не полный React/hooks/a11y preset.
  В LFS-103 подключены общий TypeScript flat config и Next-specific правила.
  Дополнительные React/hooks/a11y плагины должны поддерживать выбранный
  ESLint; переход на EOL ESLint ради preset не выполняется.
- React и React DOM совпадают по версии 19.3.1 и входят в peer-диапазон
  Next 16.4.5. Типы Node имеют major 24, а не текущий DT major 26.
- Drizzle ORM 0.45.4 и Kit 0.31.11 — stable dist-tag; ветка Drizzle 1.0
  остаётся RC и не выбирается, даже если текущие docs предлагают `@rc`.
  Будущий Better Auth 1.7.18 принимает ORM `^0.45.2` и Kit `>=0.31.4`;
  отдельный Drizzle adapter имеет согласованную версию 1.7.18.
- AI SDK 7.0.165 принимает Zod `^3.25.76 || ^4.1.8`; выбранный Zod 4.6.7
  также удовлетворяет зависимости Better Auth `^4.5.4`.
- Vitest 5.1.0 принимает Node 24 и Vite `^6.4 || ^7 || ^8`; Vite 8.3.6
  принимает Node `^20.19 || >=22.12`. Playwright 1.65.0 требует Node >=20.
  Поддержка engines/peers не заменяет будущие PostgreSQL и browser E2E-тесты.
- Stable Drizzle Kit 0.31.11 содержит deprecated транзитивные зависимости
  `@esbuild-kit/core-utils@3.3.2` и `@esbuild-kit/esm-loader@2.6.5`.
  Установка и CLI работают; предупреждение не скрывается. Не подменяем их
  принудительным override и не переходим на Drizzle RC ради его удаления.

## Альтернативы

Не выбираем prerelease/RC ради номера версии, EOL Node, Node 22 с будущим
FSRS 6, принудительное игнорирование engines/peers, ESLint 9 EOL или
неподдерживаемый parser для TypeScript 7. Не устанавливаем будущие auth,
Telegram, AI и FSRS пакеты ради одной записи в lockfile. Redis и отдельные
backend-фреймворки не вводятся; границы runtime описаны в
[ADR-003](003-runtime-boundaries.md).

## Последствия

Установка Foundation воспроизводима независимо от текущих dist-tags.
Изменение точной зависимости требует явного обновления manifest, lockfile и
этого ADR. Node patch обновляется вместе с `.nvmrc`; переход на другой major
требует новой проверки всего набора. UI, миграции, worker, env-schema и
реальные тестовые suites добавляются только в своих LFS-задачах.

## Проверка LFS-102

Проверено на Windows x64, **Node.js 24.22.2 / pnpm 10.34.9**. Для проверки
скачан официальный portable Node в игнорируемый `.cache/lfs102/runtime`;
SHA-256 архива сверён с официальным `SHASUMS256.txt`. Системный Node 24.22.1
не заменялся. В тестовой сессии portable Node и локальные Corepack shims
добавлены в PATH; на Windows `pnpm.cmd` обходит запрет исполнения `.ps1`
без изменения execution policy.

| Команда / проверка | Результат |
|---|---|
| `node --version` | PASS: v24.22.2 |
| `pnpm.cmd --version` | PASS: 10.34.9 |
| `pnpm.cmd install` | PASS: engines и peers проверены в strict-режиме; предупреждения Drizzle Kit указаны выше |
| `pnpm.cmd install --frozen-lockfile` | PASS: lockfile не изменился |
| `pnpm.cmd --dir .cache/lfs102/frozen-workspace install --frozen-lockfile --offline --store-dir <absolute-project-store>` | PASS: отдельная копия manifests/lockfile без node_modules установлена из локального store; lockfile не изменился |
| `pnpm.cmd -r list --depth 0` | PASS: зависимости выбранных версий в 7 проектах, включая root |
| `pnpm.cmd exec tsc --version`, `eslint --version`, `vitest --version`, `playwright --version`, `turbo --version` | PASS: 6.0.3 / 10.14.0 / 5.1.0 / 1.65.0 / 2.11.10 (каждый CLI запускался через `pnpm.cmd exec`) |
| `pnpm.cmd --filter @lifeos/web exec next --version` | PASS: 16.4.5 |
| `pnpm.cmd --filter @lifeos/db exec drizzle-kit --version` | PASS: Kit 0.31.11, ORM 0.45.4 |
| `pnpm.cmd exec tsc --noEmit --project tsconfig.json` | PASS: корневые tooling-скрипты |
| Импорт Next, React, React DOM, Tailwind PostCSS, Drizzle node-postgres, pg, pg-boss, Zod | PASS: загрузка без запуска сервисов |
| `pg-boss.fromDrizzle` и общий `pg` | PASS: adapter экспортируется; DB и очередь разрешают одну установку pg 8.23.1 |
| In-memory ESLint 10 + TS parser + Next plugin | PASS: валидный TSX принят, нарушение `no-img-element` отклонено |
| Установка с системным Node 24.22.1 и тем же pnpm 10.34.9 | PASS негативной проверки: `ERR_PNPM_UNSUPPORTED_ENGINE` до установки |

На момент LFS-102 `pnpm build`, `lint`, `typecheck`, `test` вызывали заглушки
LFS-101; реальные workspace pipelines ещё не были настроены.
PostgreSQL/rollback, запуск Web/worker, browser E2E и WSL2/Linux **NOT RUN**:
это проверки последующих задач или других окружений. Будущие SDK проверены
по опубликованным требованиям, не через их реальную интеграцию.

## Реализация и проверки LFS-103

Исходные версии стека сохранены; новые UI/tooling зависимости закреплены
точно и перечислены в таблице. В `packages/config` добавлен общий ESLint
config; пакет экспортирует его без отдельного build. Root `dev`/`build`
выбирают Web, `lint`/`typecheck` — Web и config. Остальные пакеты и root
`test` сохраняют заглушки до своих задач. Web использует ES2024 lib для
`PromiseWithResolvers` из типов Next 16.4.5; strict не отключён.
В Web включён рекомендованный Next `skipLibCheck`: при чередовании dev и
typegen/build оба дерева `.next/types` и `.next/dev/types` содержат
одноимённые ambient declarations. Это ограничивает проверку `.d.ts`,
сохраняя strict для исходников и проверку `.ts` route validator; настройки
библиотечных пакетов остаются прежними.

На Windows x64 / Node 24.22.2 / pnpm 10.34.9 пройдены root lint, typecheck,
production build и запуск dev. Проверены HTTP 200 для `/`, `/telegram`,
`/api/health`, точная схема health и текущий timestamp, HTTP 405 для POST
health и HTTP 404 для неизвестного URL / пути с route group в адресе.
Доступ к PostgreSQL, AI или Telegram для этих проверок не нужен.

Визуальная проверка, ручной keyboard smoke и мобильный скриншот **NOT RUN**:
Computer Use остановлен защитой из-за невозможности надёжно определить URL
Chrome. Соответствующая приёмка остаётся ручной; результаты HTTP-проверок
не выдаются за проверку отображения или доступности в браузере.

## Реализация LFS-104

Существующие прямые версии зависимостей сохранены; Web и worker получили
`workspace:*` dependency на DB. DB экспортирует собранный ESM и declarations,
не зависит от Next.js и не открывает соединение при импорте. Native Node 24
исполняет локальные TypeScript CLI; отдельный transpiler не добавлен.
`drizzle-kit generate` работает offline без credentials; официальный
node-postgres migrator применяет сгенерированный SQL и ведёт свой journal.

В DB локально включён `skipLibCheck`: Drizzle 0.45.4 содержит declarations
для optional Gel/MySQL/SQLite adapters с отсутствующими peer types и
внутренними type errors. Их проверка исключена; strict исходников и
schema/client typing сохраняется. Неиспользуемые adapters не установлены,
общий config пакетов не ослаблен. Риск deprecated Kit dependencies остаётся
описанным выше; prerelease Drizzle не используется.

Root dev/build строят DB dependency перед Web; lint/typecheck включают
Web, config и DB. Root test запускает DB unit suite, test:db — реальный
migration integration smoke с обязательным TEST_DATABASE_URL. Worker jobs,
atomic write + enqueue и общий env/API contract остаются LFS-105–LFS-107.

## Handoff LFS-109

Runtime/npm/Actions versions и PostgreSQL image digest сохранены. Актуальные
команды берутся из root/workspace package.json и `scripts/verify.ts`; старые
sections выше описывают состояние на дату соответствующего LFS-ID.
Повторная полная проверка, ограничения fresh clone/hosted CI и визуальной
приёмки зафиксированы в [Stage 1 acceptance](../tasks/STAGE-01-ACCEPTANCE.md).
Текущие runtime/package boundaries — [system](../architecture/system.md),
разработка/ADR updates — [workflow](../DEVELOPMENT_WORKFLOW.md).
