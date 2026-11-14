# ADR-003 — Один Next.js app и отдельный Node.js worker

- **Статус:** Accepted
- **Дата:** 2026-11-08
- **Связанные задачи:** LFS-102; реализация в LFS-103, LFS-105, handoff в LFS-109

## Контекст

LifeOS — модульная платформа для шести сфер развития. Языковой учитель и
Telegram — первые модуль и канал, а не отдельная архитектура всей системы.
Нужны общий HTTP/UI слой и независимое выполнение длительных задач.

## Решение

`apps/web` — одно Next.js App Router приложение для Web, будущего Mini App и
HTTP API. `apps/worker` — отдельный Node.js процесс для pg-boss jobs.
Версии обоих runtime согласованы в [ADR-001](001-stack.md); очередь описана
в [ADR-002](002-postgres-queue.md). Запуск Web не должен неявно запускать worker.

Web содержит интерфейсы, HTTP-адаптеры, transport/auth и композицию.
Независимые бизнес-правила принадлежат `packages/domain`, DTO —
`packages/contracts`, SQL schema/migrations/repositories — `packages/db`,
общие TS/ESLint/env настройки — `packages/config`.
`domain` не импортирует Next.js, React или `apps/*`; `contracts` не зависит
от приложений. Web и worker не импортируют друг друга.

Mini App получит явные URL `/telegram/*` внутри того же приложения. Route
group `(telegram)` служит организацией файлов и не добавляет сегмент URL.
Фоновые задания выполняются вне жизненного цикла HTTP-запроса.

## Альтернативы

Отдельные backend-фреймворк, Mini App сервис и микросервисы по сферам
увеличивают число деплоев и дублируют transport/auth. Выполнение jobs внутри
Web связывает их жизненный цикл с HTTP runtime. Эти варианты не выбираются.

## Последствия

Одна кодовая база и общие контракты, но два независимо запускаемых процесса.
Отдельный worker не означает отдельный доменный сервис или БД. Реальные
entrypoints, layouts, jobs и команды запуска вводятся в своих задачах;
LFS-102 фиксирует зависимости и решение, не реализует эти процессы.

## Проверка

Проверка manifests и workspace graph подтверждает отсутствие циклов и
импортов приложений. Проверка реального независимого запуска процессов
относится к LFS-103/LFS-105. Правило URL подтверждено
[официальной документацией route groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups).

## Сверка LFS-109

Два процесса сохранены: Next Web/API и отдельный Node worker. HTTP health
не выполняет SQL, production worker использует pg-boss напрямую, domain
пока пуст. DB dependency в manifests не означает готовые business repositories
или application use cases. Diagram с будущими связями и реальные imports:
[system](../architecture/system.md). URL/layout решение уточнено в
[ADR-004](004-next-routing.md). Архитектурное решение не менялось.
