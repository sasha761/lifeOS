# Stage 1 Foundation — контрольный лист приёмки

**Self-audit LFS-109: 2026-11-12.** Проверяется текущее рабочее дерево,
а не опубликованный commit: Foundation ещё не закоммичен/не отправлен.
Локальная техническая цепочка PASS. Полная приёмка Stage 1 остаётся открытой:
визуальная проверка, hosted CI и воспроизведение опубликованных исходников
не подтверждены. Stage 2 не начат.

PASS означает выполненную проверку в указанном окружении; NOT RUN — отсутствие
такого доказательства. У строки LFS-103 реализация/HTTP PASS, но итог NOT RUN
из-за непроверенного visual/keyboard/mobile критерия. Непройденных выполненных
финальных автоматических проверок (FAIL) нет.

## Статусы задач

| ID | Статус | Commit / evidence | Блокеры и пределы доказательства |
|---|---|---|---|
| LFS-101 | PASS | Шесть workspace, strict TS, package boundaries; lint/typecheck/build в текущем verify; [system](../architecture/system.md) | Рабочее дерево, не опубликованный commit |
| LFS-102 | PASS | Node 24.22.2, pnpm 10.34.9; frozen install в verify; [stack](../adr/001-stack.md) | Системный Node 24.22.1 не использовался для проверок |
| LFS-103 | NOT RUN | Production HTTP `/`, `/telegram`, `/api/health` PASS; Web unit/build/smoke PASS; [Web evidence](../../apps/web/README.md) | Visual/keyboard/mobile NOT RUN: browser access host unavailable, inventory browsers=[] |
| LFS-104 | PASS | PostgreSQL 18.6; миграции/rollback/CLI в DB integration suite; read-only metadata main/test; [schema](../architecture/database-schema.md) | Fresh migration проверяется в чистых owned test schemas; рабочие volumes не удалялись |
| LFS-105 | PASS | 24 worker unit + 5 PostgreSQL integration tests; отдельные worker/CLI, SQL output, retries/failure/shutdown; [worker](../architecture/worker.md) | Windows test fixture доставляет SIGINT/SIGTERM через IPC; POSIX проверен ранее в Linux rehearsal LFS-108 |
| LFS-106 | PASS | 12 contracts + 17 config + 24 Web unit tests; typed HTTP health, IDs/no-store; [contracts](../api/contracts.md) | Auth/AI error codes зарезервированы; соответствующих APIs нет |
| LFS-107 | PASS | 11 atomicity/idempotency cases внутри 13 DB integration tests; [atomicity ADR](../adr/002-queue-atomicity.md) | SQL effect/processed marker — test-only fixture; не exactly once для внешних эффектов |
| LFS-108 | PASS | Текущий полный verify PASS; workflow + локальный Linux rehearsal и actionlint PASS зафиксированы в [LFS-108](LFS-108.md) и [CI](../CI.md) | Hosted GitHub Actions NOT RUN; предыдущий Linux rehearsal не является hosted run |
| LFS-109 | PASS | Документы сверены с кодом, SQL metadata, scripts/paths; текущие verify/HTTP/diff проверки; [задача](LFS-109.md) | Невозможность полного fresh remote clone воспроизведения документирована ниже, как допускает задача |

## Выполненные проверки LFS-109

Окружение: Windows PowerShell, project-local Node **24.22.2** и pnpm
**10.34.9**, Docker Desktop Linux engine, PostgreSQL **18.6** в отдельных
main/test instances. Точные версии зависимостей не менялись. Перед командами
PATH включал `.cache/lfs102/runtime/node-v24.22.2-win-x64` и `.cache/bin`,
COREPACK_HOME указывал на `.cache/corepack`. Эти ignored paths — местное
окружение проверки; установка для нового разработчика описана в [README](../../README.md).

| Команда / проверка | Статус | Фактический результат |
|---|---|---|
| `docker compose --env-file .env -f infra/docker/compose.yaml --profile test up -d --wait postgres-test` | PASS | Dedicated test PostgreSQL поднят; main instance сохранён |
| `pnpm.cmd verify` | PASS | Frozen install, lint, typecheck, unit, test migrations, PostgreSQL integration, Web/worker build, production smoke; exit 0, Turbo checks без cache reuse |
| Unit suites внутри verify | PASS | config 17 + contracts 12 + db 17 + worker 24 + web 24 = **94** |
| PostgreSQL suites внутри verify | PASS | DB **13** + worker **5** = **18**, включая commit/rollback, concurrent dedupe, retry/replay и child-process lifecycle |
| `pnpm.cmd --filter @lifeos/web start --port 52322` + `node .cache/lfs109/health-check.mjs` | PASS | Production `/` и `/telegram` 200; typed `/api/health` 200, свежий timestamp, совпадающие IDs/headers, no-store; неизвестный URL и `/(telegram)/telegram` 404, POST health 405 |
| `node --env-file=.env .cache/lfs109/inspect-database.mjs` | PASS | Read-only schema metadata: main — техническая fixture/journal и pg-boss; test — fixture/journal; бизнес-таблиц нет |
| `git -c credential.helper= clone --depth 1 https://github.com/sasha761/lifeOS.git .cache/lfs109/remote-clone` | PASS | Clone создан; HEAD `8058a4e6a61a3b90a906ac2874f1cd9d59b2900c` содержит только AGENTS.md, README.md и docs, без package.json и workflow |
| Полная установка/запуск README из этого fresh remote clone | NOT RUN | В удалённом дереве отсутствует код Foundation; сначала требуется его review и публикация. pnpm из вложенного clone не запускался |
| Visual/keyboard/mobile через browser automation | NOT RUN | Создание browser tab завершилось `The browser access host is unavailable`; inventory browsers=[]; UI не наблюдался |
| Hosted GitHub Actions run | NOT RUN | Workflow пока только в рабочем дереве; публикация/PR не выполнялись |
| Отдельный WSL2 walkthrough | NOT RUN | Текущий запуск — Windows; Linux rehearsal LFS-108 указан отдельно ниже |
| `node .cache/lfs109/audit-docs.mjs` | PASS | Relative Markdown links, локальные paths/package scripts и baseline scope сверены; runtime/lock/migrations/Master Plan не изменены |
| `git diff --check` и `git diff --no-index --check .cache/lfs109/baseline .cache/lfs109/after` | PASS | Whitespace ошибок нет; snapshot учитывает и untracked файлы |
| `docker compose --env-file .env -f infra/docker/compose.yaml --profile test stop postgres-test` | PASS | Поднятый для этой задачи test instance остановлен; volumes сохранены, main instance не останавливался |

Полный локальный stdout verify: `.cache/lfs109/verify.log`, HTTP result:
`.cache/lfs109/health-result.json`, SQL metadata:
`.cache/lfs109/database-metadata.json`, task diff/stat/file list:
`.cache/lfs109/review.md`. Эти ignored evidence-файлы дополняют таблицу;
в новом clone они не появятся. Проверки составлены из существующих
[scripts](../../package.json), [verify](../../scripts/verify.ts),
[build smoke](../../scripts/build-smoke.ts),
[DB tests](../../packages/db/tests/integration) и
[worker tests](../../apps/worker/tests/integration).

Предыдущий **LFS-108**: clean Linux copy без host node_modules/dist, Node
24.22.2 в Debian bookworm-slim, fresh frozen install и полный verify PASS
(94 unit + 18 PostgreSQL), shuffled integration suites PASS, actionlint
1.7.11 PASS. Это отдельное ранее выполненное доказательство, не новый запуск
LFS-109, не Git clone, не WSL2 и не GitHub-hosted Ubuntu.
Логи/команды приведены в [LFS-108](LFS-108.md); повторять их после одних
документационных изменений не требовалось.

## Сквозная приёмка этапа

- [x] `pnpm install --frozen-lockfile` воспроизводим — выполнен внутри текущего verify; также fresh Linux install LFS-108.
- [x] Web доступен (`/`, `/telegram`, `/api/health`) — production HTTP и smoke PASS; visual проверка отдельно NOT RUN.
- [x] Миграции применяются на чистой test DB — проверено на чистых owned schemas отдельной test instance; это не пересоздание целого DB volume.
- [x] Demo job отправлен и обработан отдельным worker — отдельные child processes, подтверждение SQL state/output.
- [x] Rollback тест вернул rollback для data+job — реальные Drizzle/pg-boss/PostgreSQL tests.
- [x] Idempotency тест не породил дубли — sequential/concurrent producers и consumer replay; fixture-only SQL effect.
- [x] CI или все его проверки выполнены и зафиксированы — локальный verify PASS; hosted CI остаётся NOT RUN.
- [x] README/ADR/API/DB/worker docs совпадают с кодом — paths/scripts/SQL/runtime сверены в LFS-109.
- [x] В проекте нет преждевременной реализации Этапов 2–8 — только технический Foundation; Auth/goals/Telegram/AI не добавлялись.

Отмеченные пункты подтверждают перечисленные локальные проверки, а не
полную пользовательскую приёмку LFS-103 или опубликованного проекта.
После проверок временный production Web и test PostgreSQL остановлены
без удаления volumes. Main DB остаётся запущенной.

## Решение о переходе к Stage 2

- **Дата self-audit:** 2026-11-12.
- **Решение:** ожидает приёмки пользователя; разрешение перехода не дано.
- **Ручные действия:** review накопленных изменений Foundation и их публикация;
  затем hosted CI и fresh-clone walkthrough; визуальная/keyboard/mobile проверка Web.
- **Следующий этап:** отдельная постановка одного LFS-ID Stage 2 после решения
  пользователя. LFS-201–210 описаны в Master Plan, task files для них пока нет.
- **Замечания:** архитектурные границы сохранены, Master Plan не изменён.
  Новые функции auth/целей/сфер/Telegram/AI в LFS-109 не реализованы.
