# Задачи LifeOS: очередь и статус

Одна сессия исполнителя — один LFS-ID по [AGENTS.md](../../AGENTS.md). Следующая задача начинается только после
проверки предыдущей владельцем.

**Как обновлять этот файл.** В конце задачи исполнитель ставит дату в колонку «Статус» и правит блок «Сейчас».
Отчёт о задаче (проверки, число тестов, ограничения, ручные действия) пишется только в разделе «Результат» её
файла `LFS-XXX.md` и сюда не копируется. Полная история — разделы «Результат» и git.

## Сейчас

| | |
|---|---|
| Этап | 2 — LifeOS Core. Основная очередь закрыта; по замечаниям владельца после проверки страниц добавлены доработки LFS-222–229 ([STAGE-02-FEEDBACK](STAGE-02-FEEDBACK.md)) |
| Следующая задача по очереди | **LFS-225** — статусы целей, цели без измерений и дата начала, по макетам `32`, `33`, `36`, `44` (LFS-223). Ветки идут цепочкой: `lfs-224-goal-row` от `lfs-223-rework-mockups`, та от `lfs-222-remove-rhythm`, та от `lfs-221-open-signup`, та от `lfs-220-first-login-popup`, та от `lfs-219-onboarding-wizard`; код LFS-219 ещё не влит в `main` (PR #7 влит в `lfs-218-starter-pack`) |
| Вне очереди | LFS-214, LFS-215: риски LFS-213, Stage 3 не блокируют, место назначает владелец |
| Миграции | Последняя в репозитории — `0009_drop_checkin_rhythm` (LFS-222: удаляет `user.checkin_rhythm`). Основная база владельца мигрирована до `0009` по его решению (отчёт LFS-222); код веток до LFS-222 на ней не запускается |
| Приёмка | Stage 1 — [STAGE-01-ACCEPTANCE](STAGE-01-ACCEPTANCE.md); Stage 2 — [STAGE-02-ACCEPTANCE](STAGE-02-ACCEPTANCE.md). Hosted CI проходил на PR #2 (LFS-212), #3 (LFS-209), #4 (LFS-213) |
| Stage 3 | Начинается после LFS-228 и решения владельца по чек-листу приёмки Stage 2 |

Статусы в таблицах: ✅ дата — выполнена (дата из раздела «Результат»), ▶ — следующая, пусто — не начата.

## Stage 1 — Foundation

Выполнялась в порядке номеров. Приёмка и незакрытые пункты — [STAGE-01-ACCEPTANCE](STAGE-01-ACCEPTANCE.md).

| ID | Короткое название | Статус |
|---|---|---|
| [LFS-101](LFS-101.md) | Monorepo scaffold | ✅ |
| [LFS-102](LFS-102.md) | Versions and ADR | ✅ |
| [LFS-103](LFS-103.md) | Next.js shell | ✅ |
| [LFS-104](LFS-104.md) | PostgreSQL and migrations | ✅ |
| [LFS-105](LFS-105.md) | pg-boss worker | ✅ |
| [LFS-106](LFS-106.md) | Contracts and validation | ✅ |
| [LFS-107](LFS-107.md) | Atomic transaction and idempotency | ✅ |
| [LFS-108](LFS-108.md) | CI, checks, builds | ✅ |
| [LFS-109](LFS-109.md) | Architecture and handoff documentation | ✅ 2026-11-12 |

## Stage 2 — LifeOS Core

Порядок выполнения отличается от нумерации; описание этапа — [STAGE-02-README](STAGE-02-README.md).
Задачи с буквой в колонке «Очередь» вставлены владельцем позже; в шапке такой задачи указано, перед или после чего она идёт.

| Очередь | ID | Короткое название | Статус |
|---:|---|---|---|
| 1 | [LFS-201](LFS-201.md) | Better Auth, allowlist, reset | ✅ 2026-11-14 |
| 2 | [LFS-202](LFS-202.md) | Profile, timezone/locale, ownership | ✅ 2026-11-15 |
| 3 | [LFS-203](LFS-203.md) | Life domains registry | ✅ 2026-11-15 |
| 4 | [LFS-205](LFS-205.md) | Goals schema and rules | ✅ 2026-11-15 |
| 5 | [LFS-210](LFS-210.md) | Activity events and audit | ✅ 2026-11-15 |
| 6 | [LFS-206](LFS-206.md) | Goal measurements | ✅ 2026-11-16 |
| 7 | [LFS-207](LFS-207.md) | Goals API and progress | ✅ 2026-11-16 |
| 8 | [LFS-208](LFS-208.md) | Goals UI | ✅ 2026-11-16 |
| 8a | [LFS-211](LFS-211.md) | Design System v2: dark, Inter, top bar | ✅ 2026-11-17 |
| 9 | [LFS-204](LFS-204.md) | Dashboard of six domains | ✅ 2026-11-17 |
| 9a | [LFS-212](LFS-212.md) | UI-kit and mockup comparison | ✅ 2026-11-17 |
| 10 | [LFS-209](LFS-209.md) | E2E, security, acceptance | ✅ 2026-11-17 |
| 10a | [LFS-213](LFS-213.md) | Stage 2 page layout per mockups | ✅ 2026-11-18 |
| 10b | [LFS-216](LFS-216.md) | Goal deletion | ✅ 2026-11-18 |
| 10c | [LFS-217](LFS-217.md) | Edit start and target before first measurement | ✅ 2026-11-19 |
| 10d | [LFS-218](LFS-218.md) | Starter pack on user's choice | ✅ 2026-11-20 |
| 10e | [LFS-219](LFS-219.md) | Onboarding wizard | ✅ 2026-11-20 |
| 10f | [LFS-220](LFS-220.md) | First-login popup and settings entry | ✅ 2026-11-21 |
| 10g | [LFS-221](LFS-221.md) | Open registration (`AUTH_SIGNUP_MODE`) | ✅ 2026-11-21 |
| 10h | [LFS-222](LFS-222.md) | Remove check-in rhythm | ✅ 2026-11-22 |
| 10i | [LFS-223](LFS-223.md) | Mockups for Stage 2 rework | ✅ 2026-11-23 |
| 10j | [LFS-224](LFS-224.md) | Goals list: row, whole-card click, hover, delete | ✅ 2026-11-23 |
| 10k | [LFS-225](LFS-225.md) | Goal statuses, goals without measurements, start date | ▶ |
| 10l | [LFS-226](LFS-226.md) | Contribution measurements, dialog per goal kind | |
| 10m | [LFS-229](LFS-229.md) | Goals board, view switch, drag and drop | |
| 10n | [LFS-227](LFS-227.md) | Onboarding catalog v2 | |
| 10o | [LFS-228](LFS-228.md) | New goal as a question wizard | |

Описание первого входа и макеты для LFS-218–220 — [ONBOARDING](../reference/ui/ONBOARDING.md).
Замечания владельца, его решения и пожелания к будущим модулям для LFS-222–229 — [STAGE-02-FEEDBACK](STAGE-02-FEEDBACK.md).
Макеты доработок и решения владельца при их одобрении — [LFS-223](LFS-223.md).

### Вне очереди

Доработки по рискам LFS-213 (добавлены 2026-11-18). Stage 3 не блокируют, место в очереди назначает владелец.

| ID | Короткое название | Статус |
|---|---|---|
| [LFS-214](LFS-214.md) | Activity journal pagination | |
| [LFS-215](LFS-215.md) | 404 and redirect status under streaming | |
