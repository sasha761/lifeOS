# Stage 1 — список отдельных задач Codex

Выполнять в порядке `LFS-101` → `LFS-109` из [корневого README](../../README.md). Все задачи предназначены для самостоятельного запуска в Codex, не выполняются одним большим запросом.

**Правило:** сначала открыть `AGENTS.md`, затем нужный `LFS-XXX.md`. В отчёте Codeх указывает выполненные критерии готовности и статус тестов. Следующая задача начинается только после проверки предыдущей пользователем.

| ID | Короткое название |
|---|---|
| [LFS-101](LFS-101.md) | Monorepo scaffold |
| [LFS-102](LFS-102.md) | Versions and ADR |
| [LFS-103](LFS-103.md) | Next.js shell |
| [LFS-104](LFS-104.md) | PostgreSQL and migrations |
| [LFS-105](LFS-105.md) | pg-boss worker |
| [LFS-106](LFS-106.md) | Contracts and validation |
| [LFS-107](LFS-107.md) | Atomic transaction and idempotency |
| [LFS-108](LFS-108.md) | CI, checks, builds |
| [LFS-109](LFS-109.md) | Architecture and handoff documentation |

# Stage 2 — LifeOS Core

Порядок выполнения отличается от нумерации; описание этапа и очередь — в [STAGE-02-README](STAGE-02-README.md). Приёмка — [STAGE-02-ACCEPTANCE](STAGE-02-ACCEPTANCE.md), промпт для первой задачи — [STAGE-02-FIRST-CODEX-PROMPT](STAGE-02-FIRST-CODEX-PROMPT.md).

| Очередь | ID | Короткое название |
|---:|---|---|
| 1 | [LFS-201](LFS-201.md) | Better Auth, allowlist, reset |
| 2 | [LFS-202](LFS-202.md) | Profile, timezone/locale, ownership |
| 3 | [LFS-203](LFS-203.md) | Life domains registry |
| 4 | [LFS-205](LFS-205.md) | Goals schema and rules |
| 5 | [LFS-210](LFS-210.md) | Activity events and audit |
| 6 | [LFS-206](LFS-206.md) | Goal measurements |
| 7 | [LFS-207](LFS-207.md) | Goals API and progress |
| 8 | [LFS-208](LFS-208.md) | Goals UI |
| 8a | [LFS-211](LFS-211.md) | Design System v2: dark, Inter, top bar |
| 9 | [LFS-204](LFS-204.md) | Dashboard of six domains |
| 9a | [LFS-212](LFS-212.md) | UI-kit and mockup comparison |
| 10 | [LFS-209](LFS-209.md) | E2E, security, acceptance |

Локальный статус 2026-11-15: LFS-202 проверена повторно (36 Web integration
tests); LFS-203 выполнена, evidence — в [её отчёте](LFS-203.md#результат-lfs-203--2026-11-15).
LFS-205 выполнена: [контракты, схема и сервис целей](LFS-205.md#результат-lfs-205--2026-11-15),
326 unit + 95 PostgreSQL integration tests, main/test migration 0003 применена.
LFS-210 выполнена: [транзакционный аудит и receipts](LFS-210.md#результат-lfs-210--2026-11-15),
360 unit + 108 PostgreSQL integration tests, main/test migration 0004 применена.
LFS-206 выполнена 2026-11-16: [ручные измерения и current](LFS-206.md#результат-lfs-206--2026-11-16),
403 unit + 122 PostgreSQL integration tests, main/test migration 0005 применена.
LFS-207 выполнена 2026-11-16: [HTTP API и точный прогресс](LFS-207.md#результат-lfs-207--2026-11-16),
451 unit + 135 PostgreSQL integration tests; новых миграций нет.
LFS-208 выполнена 2026-11-16: [UI целей и измерений](LFS-208.md#результат-lfs-208--2026-11-16),
472 unit + 135 PostgreSQL integration + 10 Playwright desktop/mobile; без новых миграций.
LFS-211 выполнена 2026-11-17: [Design System v2](LFS-211.md#результат-lfs-211--2026-11-17),
ADR-011 Accepted, Inter 5.3.0 self-hosted; 477 unit + 135 PostgreSQL integration + 10 Playwright
desktop/mobile; без миграций и изменений API.
LFS-204 выполнена 2026-11-17: [Dashboard шести сфер](LFS-204.md#результат-lfs-204--2026-11-17),
`GET /api/v1/dashboard`; 497 unit + 139 PostgreSQL integration + 14 Playwright desktop/mobile;
без миграций.
Следующая задача по очереди — LFS-212 (вставлена перед LFS-209); она не начата. Hosted CI отдельно не запускался.
