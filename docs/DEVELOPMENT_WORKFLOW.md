# Разработка и handoff LifeOS

Перед изменениями прочитайте [AGENTS.md](../AGENTS.md), текущую
`docs/tasks/LFS-XXX.md`, связанные ADR и [README](../README.md).
Задача уточняет правила только в своём scope; смена архитектурного решения
требует согласованного ADR. Состояние Foundation и открытые проверки:
[Stage 1 acceptance](tasks/STAGE-01-ACCEPTANCE.md).

## Один LFS-ID за один проход

Сначала проверьте состояние, tracked и untracked файлы:

```sh
git status --short
git diff --stat
git diff
git ls-files --others --exclude-standard
```

В текущем рабочем дереве накоплены незакоммиченные этапы Foundation. Обычный
`git diff` не показывает содержимое untracked files. Нельзя удалять их,
сбрасывать дерево или автоматически приписывать всё следующему LFS-ID.
Перед публикацией сохраните и разделите предыдущую работу по фактическому
scope; при необходимости используйте локальные копии/diff для review.

После проверки baseline создайте отдельную ветку, например
`git switch -c lfs-201-auth` для отдельно поставленной LFS-201. Наличие этой
ветки в примере не означает разрешение начинать Stage 2. Один PR содержит
один LFS-ID; несвязанные исправления и будущие функции выносятся отдельно.

## Порядок реализации

1. Контракты/типы и границы неизвестного входа.
2. Реализация в правильном пакете; Web содержит UI/transport/composition.
3. Позитивные и негативные проверки критичных границ.
4. Документация, ADR при реальном изменении решения, acceptance evidence.

DTO должны проходить Zod; API errors не раскрывают внутренние данные.
Domain не импортирует Next/React/apps и не выполняет SQL в обход repositories.
Персональные данные будущих модулей требуют серверного ownership, user_id
и provenance. Нельзя добавлять фиктивный общий процент успешности жизни.
Добавление Language Tutor не должно менять общий модульный контракт платформы.

Зависимости закрепляются точными версиями и lockfile, совместимость сверяется
с официальными docs и установленными types/source. Не использовать latest
как незакреплённую dependency. Миграции генерируются `pnpm db:generate`,
применённая история не переписывается. Исправление schema — новая миграция.
Запрещены git reset --hard, удаление чужих изменений, database/volume cleanup
вне согласованного scope. Test cleanup ограничен freshly owned namespaces.

## Проверки перед review

После запуска Docker и настройки ignored root .env:

```sh
pnpm db:test:up
pnpm verify
git diff --check
git diff --stat
git status --short
```

`verify` использует точный Node из .nvmrc и pnpm из packageManager, выполняет
frozen install, lint/typecheck, unit, test migrations, реальные PostgreSQL
integration suites, Web/worker builds и smoke. Состав и env — [CI](CI.md).
Отказ инфраструктуры фиксируется как FAIL/NOT RUN с точной причиной, а не PASS.
Не повторяйте уже прошедшие проверки без новых изменений или нерешённой проблемы.

Для task-specific проверки используйте реальные scripts из package.json:
`pnpm test:db`, `pnpm test:worker`, `pnpm test:integration`, `pnpm test:build`.
Build smoke требует предыдущего `pnpm build`. Health HTTP 200 не доказывает
доступность PostgreSQL и не заменяет визуальную/keyboard/mobile приёмку.

## Commit и PR

Стадируйте только проверенные paths, а не весь неизвестный dirty tree.
Пример сообщения: `LFS-109: document Foundation handoff`.
Проверяйте staged diff и отсутствие .env, credentials, node_modules, .next,
dist, .cache и личных данных. Кешированные локальные evidence-файлы не
должны быть единственным описанием результата: команды/ограничения фиксируются
в task/acceptance docs.

PR description начинается с проблемы и итогового поведения. Укажите scope,
точные выполненные команды и PASS/FAIL/NOT RUN, ограничения и необходимые
ручные действия. Ссылку на GitHub run добавляйте только после реального
выполнения; наличие YAML или локальный Linux rehearsal не равны hosted run.
Deploy/merge/publish не считаются выполненными только потому, что build прошёл.

Checklist reviewer:

- [ ] Изменения укладываются в один LFS-ID и сохраняют baseline.
- [ ] Контракты, runtime/package boundaries и migrations согласованы.
- [ ] Проверки выполнялись в указанном окружении, их ограничения видны.
- [ ] API/logs/client bundles не раскрывают secrets или персональные данные.
- [ ] README/architecture/ADR/task acceptance соответствуют фактическому коду.
- [ ] PR не содержит функций следующего этапа и ложных заявлений о готовности.

## ADR и архитектурные документы

Используйте [краткий шаблон](adr/000-template.md): context, decision,
alternatives, consequences и фактическая validation. Не переписывайте
принятое решение задним числом ради желаемой архитектуры. Старые findings
помечайте датой, новые ограничения/проверки добавляйте отдельно.

Текущие решения: [stack](adr/001-stack.md), [queue](adr/002-postgres-queue.md),
[atomicity supplement](adr/002-queue-atomicity.md),
[runtime boundaries](adr/003-runtime-boundaries.md), [routing](adr/004-next-routing.md).
Два файла ADR-002 сохранены по историческим task paths; второй — дополнение,
не другая очередь. Для нового независимого решения выбирайте свободный номер.

## Передача следующему этапу

Stage 2 в Master Plan — Better Auth, user timezone/locale и ownership,
реестр шести сфер, Dashboard, goals/measurements/activity_events и ручной
прогресс. Ничего из этого не реализовано в LFS-109.
Отдельных task files LFS-201–210 в этом execution pack пока нет: перед кодом
нужна отдельная постановка текущего LFS-ID и проверка зависимостей/версий.

Переход возможен после review Foundation и явного решения пользователя.
Publication/hosted CI и визуальные пункты приёмки отслеживаются в Stage 1
checklist. Исполнение LFS-109 не даёт автоматического разрешения начинать
auth, цели, Telegram, AI или учебные модули.
