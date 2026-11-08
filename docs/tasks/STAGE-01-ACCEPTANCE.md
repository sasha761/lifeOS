# Stage 1 Foundation — контрольный лист приёмки

> Заполнять **после** выполнения задач, используя фактический вывод команд. Начальное состояние: ничего не подтверждено.

| ID | Статус (NOT STARTED / PASS / FAIL / NOT RUN) | Commit / evidence | Блокеры |
|---|---|---|---|
| LFS-101 | NOT STARTED | — | — |
| LFS-102 | NOT STARTED | — | — |
| LFS-103 | NOT STARTED | — | — |
| LFS-104 | NOT STARTED | — | — |
| LFS-105 | NOT STARTED | — | — |
| LFS-106 | NOT STARTED | — | — |
| LFS-107 | NOT STARTED | — | — |
| LFS-108 | NOT STARTED | — | — |
| LFS-109 | NOT STARTED | — | — |

## Сквозная приёмка этапа

- [ ] `pnpm install --frozen-lockfile` воспроизводим.
- [ ] Web доступен (`/`, `/telegram`, `/api/health`).
- [ ] Миграции применяются на чистой test DB.
- [ ] Demo job отправлен и обработан отдельным worker.
- [ ] Rollback тест вернул rollback для data+job.
- [ ] Idempotency тест не породил дубли.
- [ ] CI или все его проверки выполнены и зафиксированы.
- [ ] README/ADR/API/DB/worker docs совпадают с кодом.
- [ ] В проекте нет преждевременной реализации Этапов 2–8.

## Решение о переходе к Stage 2

- **Дата:** не определена
- **Решение:** ожидает приёмки
- **Замечания:** —
