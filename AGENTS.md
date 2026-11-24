# AGENTS.md — правила ИИ-исполнителей LifeOS

> Правила общие для Codex и Claude Code (Claude Code читает их через `CLAUDE.md`). Уточнения внутри конкретной задачи
> `docs/tasks/LFS-XXX.md` приоритетны только в пределах её scope; изменения глобальной архитектуры требуют ADR.
> Правило, которое касается обоих агентов, записывается здесь или в `docs/`, а не в личную память агента: её второй агент не видит.

## Продукт

LifeOS — модульная платформа управления целями и развитием человека в сферах Languages, Finance, Work, Projects, Skills и Health. Языковой учитель — первый детально реализуемый модуль; он не должен определять архитектуру всей платформы.

## Где что лежит

| Что | Где |
|---|---|
| Продукт, этапы, требования | [Master Plan v0.4](docs/reference/LifeOS_Master_Plan_v0.4.md): §1 продукт, §2 границы релизов, §3 архитектура, §5 модель прогресса, §7 этапы, §9 безопасность. Формулировки не менять |
| Дизайн-система, модули Tasks и Job Search | [спека v0.2](docs/reference/LifeOS_Design_Tasks_Jobs_v0.2.md): §16 дизайн, §17 Tasks, §18 Job Search |
| Очередь задач и текущий статус | [docs/tasks/README.md](docs/tasks/README.md), блок «Сейчас»; задача — `docs/tasks/LFS-XXX.md` |
| Архитектура | [system](docs/architecture/system.md), [схема БД](docs/architecture/database-schema.md), [worker](docs/architecture/worker.md) |
| HTTP API и DTO | [docs/api/contracts.md](docs/api/contracts.md) |
| Принятые решения | [индекс ADR](docs/adr/README.md) |
| Интерфейс | [UI_GUIDELINES](docs/UI_GUIDELINES.md), макеты и их страницы — [PAGES.md](docs/reference/ui/PAGES.md) |
| Ветки, PR, ревью | [DEVELOPMENT_WORKFLOW](docs/DEVELOPMENT_WORKFLOW.md); как делят работу Codex и Claude Code — [AI_AGENTS](docs/AI_AGENTS.md) |
| Процедура выполнения и ревью задачи | [.claude/skills/lfs/SKILL.md](.claude/skills/lfs/SKILL.md), [.claude/skills/lfs-review/SKILL.md](.claude/skills/lfs-review/SKILL.md). Codex вызывает те же процедуры командами `$lfs`, `$lfs-auto`, `$lfs-review` из [.agents/skills/](.agents/skills/) — [AI_AGENTS](docs/AI_AGENTS.md#codex-команды-и-настройка) |
| Установка, запуск, все маршруты | [README.md](README.md); переменные окружения — `.env.example` |

## Технологический контракт

- **Везде TypeScript strict**: Next.js App Router + React (web, Mini App, API), отдельный Node.js worker.
- pnpm workspaces + Turborepo, PostgreSQL + Drizzle, pg-boss. **Не добавлять Redis, NestJS, Prisma, Laravel, Nuxt, Vue, микросервисы** без отдельного согласованного ADR.
- Слой `packages/domain` не импортирует `next/*`, `react`, `apps/*` и не выполняет произвольные запросы в обход репозиториев; `packages/contracts` не зависит от приложений.
- В `apps/web` только интерфейсы, HTTP-адаптеры, композиция и transport/auth. Доменная логика — в пакетах.
- Route group `(telegram)` не влияет на URL; реальный будущий путь — `/telegram/*`.
- Персональные данные и прогресс в будущем должны иметь явный `user_id`, provenance и серверный ownership. Не создавать фиктивный общий процент успешности жизни.
- Версии фиксируются в `pnpm-lock.yaml` и `docs/adr/001-stack.md`; не использовать `latest` без закрепления в lockfile.
- Использовать официальную документацию совместимых версий. Не угадывать методы SDK. Для `apps/web` (Next.js 16) сначала читать нужный раздел `apps/web/node_modules/next/dist/docs/`.

## Как писать код: образцы

Новый код повторяет устройство существующего. Прежде чем писать своё, найди готовое и переиспользуй; копию логики рядом не делай.

| Что добавляешь | Образец |
|---|---|
| DTO и Zod-схемы | `packages/contracts/src/goals.ts`, экспорт через `src/index.ts` |
| Доменный сервис и порт репозитория | `packages/domain/src/core/goals.ts` (`GoalsRepository`, `GoalsUnitOfWork`, `createGoalsService`), ошибки — `core/errors.ts` |
| Таблица | `packages/db/src/schema/goals.ts`, затем `pnpm db:generate` → новый файл в `packages/db/drizzle/` |
| Репозиторий и транзакция | `packages/db/src/repositories/goals.ts`, `packages/db/src/goals-unit-of-work.ts`; фильтр владельца — `ownership.ts` |
| HTTP-роут | `app/api/v1/goals/route.ts` только подключает обработчики; логика — `apps/web/server/goals.ts` (`apiRoute`, `requireApiActor`, `ApiError`); сервисы собираются в `apps/web/server/core.ts` |
| Страница и UI | `apps/web/app/(web)/goals/(browse)/`, компоненты `apps/web/components/goals/`, общие — `components/ui/`; запросы к API — `apps/web/lib/goals-api-client.ts` |
| Тесты | unit — `packages/*/tests/*.test.ts`, `apps/web/tests/*.test.ts(x)`; PostgreSQL — `apps/web/tests/integration/`, `packages/db/tests/integration/`; e2e — `apps/web/tests/e2e/*.spec.ts` |

В HTTP-обработчиках ошибки не оборачиваются в try/catch «на всякий случай»: обработчик бросает `ApiError` или доменную ошибку, а общий `apiRoute` превращает её в безопасный ответ и пишет технический лог. В остальном коде `catch` нужен только с понятной заменой (запасной формат, сообщение пользователю); если ошибку можно пропустить, комментарий объясняет почему. `any` запрещён (typescript-eslint).

## Рабочий процесс

1. Прежде чем менять код, прочитать задачу, связанные ADR и нужные документы из карты выше; проверить `git status`, существующие файлы и конфликты. Если в этой папке сейчас работает другой агент, правки не начинать, а спросить владельца.
2. Выполнить **ровно один LFS-ID**. Не внедрять заранее фичи следующих этапов.
3. Перед изменением файлов показать план и дождаться «ОК» владельца. Исключение — команда Codex `$lfs-auto`, которую владелец
   запускает явно: она сама берёт следующую задачу и выполняет её без остановок по правилам
   [.agents/skills/lfs-auto/SKILL.md](.agents/skills/lfs-auto/SKILL.md) (решение владельца 2026-11-25).
4. Сначала контракт и типы → реализация → тесты → документация; минимальные изменения, без большого рефакторинга по собственной инициативе.
5. Никаких удалений чужих изменений или агрессивных команд (`git reset --hard`, удаление БД/volume). Незакоммиченные изменения других задач не трогать и себе не приписывать. Нужна опасная операция — запросить согласие.
6. Валидация неизвестных входных данных, безопасные ошибки API и отсутствие секретов в логах. `.env` не читать и не выводить: список переменных — в `.env.example`.
7. Все тесты запускать в текущем окружении; если инфраструктура недоступна, не утверждать, что тесты пройдены.
8. Коммит и пуш исполнитель делает сам, разрешения не спрашивает (решение владельца 2026-11-21). Перед первой правкой — ветка задачи `lfs-<номер>-<кратко>` (создать, если её нет); после проверок — коммит `LFS-XXX: <что сделано>` и `git push`; правки по ревью — новыми коммитами в ту же ветку. Нельзя: коммитить или пушить напрямую в `main`, force push, переписывать запушенную историю, вливать PR — это делает владелец.
9. Скрипты проекта (`pnpm …`: проверки, сборка, `pnpm dev`, `pnpm db:generate`, `pnpm db:migrate` в том числе к основной базе) исполнитель запускает сам, без вопроса. С согласия владельца: новая зависимость (`pnpm add`), удаление БД, volume или данных и другие операции из п. 5.
10. Скриншоты и прочие временные файлы класть в `.cache/` (он в `.gitignore`), а не в корень репозитория.
11. Перед завершением показать `git diff --stat` (или список коммитов задачи), перечислить реальные проверки и незакрытые проблемы.
12. ADR обновлять при реальном изменении архитектурного решения. Не менять формулировки Master Plan без согласования.
13. Отвечать владельцу по-русски.

## Команды

| Зачем | Команда |
|---|---|
| Полная проверка (как CI) | `pnpm db:test:up`, затем `pnpm verify` |
| Части проверки | `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build` |
| UI: Playwright и скриншоты против макетов | `pnpm test:ui`, `pnpm ui:shots` → `.cache/ui-shots/` |
| Новая миграция | `pnpm db:generate`; к test DB её применяет `pnpm verify`, к основной — `pnpm db:migrate` |
| Локальный запуск | `pnpm dev` (Web), `pnpm worker:dev` (worker) |

Порядок проверок и их ограничения — [DEVELOPMENT_WORKFLOW](docs/DEVELOPMENT_WORKFLOW.md) и [CI](docs/CI.md).

## Интерфейс

- UI делается строго по `docs/UI_GUIDELINES.md`: цвета, радиусы и шрифт только токенами из `apps/web/app/globals.css`, без hex в компонентах; общие компоненты из `apps/web/components/ui`.
- Макет страницы: `docs/reference/ui/NN-*.png` (вид) и `docs/reference/ui/html/NN-*.html` (точные размеры); какой макет к какой странице — `docs/reference/ui/PAGES.md`. Данные с макетов в код не переносить.
- В каждой UI-задаче: до кода выписать элементы макета, после кода снять скриншоты 1440 и 390 px, сравнить с макетом и дать в отчёте таблицу отличий с причинами. Какие отличия допустимы — UI_GUIDELINES §4. Ревьюер повторяет сравнение; необъяснённое отличие — блокер.

## Тесты и готовность

Тесты `Vitest` для логики, PostgreSQL integration tests для транзакций, lint + typecheck + build в CI. В Phase 1 нужна хотя бы одна позитивная и негативная проверка каждой критичной границы (валидация env, транзакция rollback, идемпотентность).

## В конце задачи обновить

Документ, который больше не соответствует коду, исправляется в той же задаче. Старое утверждение заменяется, а не дополняется новым абзацем ниже.

- `docs/tasks/LFS-XXX.md` — раздел «Результат LFS-XXX · ГГГГ-ММ-ДД».
- `docs/tasks/README.md` — статус задачи в таблице очереди и блок «Сейчас» (следующая задача, миграции).
- Новый или изменённый HTTP-маршрут, DTO, код ошибки — `docs/api/contracts.md` и список маршрутов в `README.md`.
- Миграция — `docs/architecture/database-schema.md`.
- Новый пакет, процесс, поток данных или маршрут страницы — `docs/architecture/system.md`.
- Изменилось архитектурное решение — ADR (новый или дополнение) и строка в `docs/adr/README.md`.
- Изменились запуск, env или команды — `README.md`, `.env.example`, раздел «Команды» выше.
- Новое решение владельца в рамках задачи — раздел «Решения владельца» в её файле.

## Известные ловушки

- Next.js 16 отличается от того, что ты знаешь: API сверять по `apps/web/node_modules/next/dist/docs/`. Блок `nextjs-agent-rules` в `apps/web/AGENTS.md` пишет сам `next dev`; не удалять, коммитить вместе с работой.
- Не класть catch-all `[...catchAll]` в корень parallel-слота `(web)/@modal`: Next подмешивает его ко всем адресам, и строгое сопоставление маршрутов отбрасывает страницы других групп (`/auth/*`, `/telegram`, `/onboarding` → 404 в dev). Флаг `deprecated.looseRouteMatching` не включать: он прячет ошибку и в production превращает 404 в 200. Подробности — README, раздел Web.
- Маршрут, который отвечает 404, проверяет только build smoke в `pnpm verify`; Playwright этого не ловит. После правок маршрутов, `proxy.ts` или `next.config.ts` запускать `pnpm build` и `pnpm test:build`.
- В PowerShell с запретом `.ps1` использовать `pnpm.cmd`. `verify` требует точный Node из `.nvmrc`.
- Integration-тесты требуют отдельный `TEST_DATABASE_URL`; основная база не fallback. Тестовая БД общая для всех worktree, поэтому `pnpm verify` не запускать параллельно.
- `git diff` не показывает новые файлы: смотреть ещё `git ls-files --others --exclude-standard`.
- Применённые миграции не переписываются; исправление схемы — новая миграция.
- `pnpm start` (production) требует `MAIL_TRANSPORT=smtp`; для локальной почты — `pnpm dev`. HTTP 200 от `/api/health` не доказывает доступность PostgreSQL.
- У ADR-002 два файла: `002-postgres-queue.md` и дополнение `002-queue-atomicity.md`. Новое решение получает следующий свободный номер.

## Структура результата

- **Реализовано**: краткий итог.
- **Файлы**: список изменённых/созданных.
- **Проверки**: точные команды, PASS/FAIL/NOT RUN и причина.
- **Acceptance criteria**: чек-лист по текущему LFS-ID.
- **Ручные действия**: только необходимые действия пользователя; не выдавать их за выполненные.
- **Риски/следующий шаг**: максимум 3–5 пунктов.
