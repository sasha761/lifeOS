# ADR-004 — Явные Mini App URL и общий Next.js root layout

- **Статус:** Accepted; фиксация существующей реализации LFS-103.
- **Дата:** 2026-11-12.
- **Связанные задачи:** LFS-103, LFS-109; [runtime boundaries](003-runtime-boundaries.md).

## Контекст

Web и будущая Telegram Mini App используют одно Next.js App Router приложение,
но разные внутренние layouts. Пользователю нужен реальный namespace
`/telegram/*`; организационная route group сама URL не создаёт.

## Решение

Сохраняем один `apps/web/app/layout.tsx`. `(web)` и `(telegram)` разделяют
presentation layouts. Страница `app/(web)/page.tsx` отвечает `/`, а
`app/(telegram)/telegram/page.tsx` создаёт `/telegram` за счёт явной папки.
Health находится в `app/api/health/route.ts` вне этих групп.

Семантика route groups сверена с
[официальными Next.js docs](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups)
и проверена на закреплённом Next 16.4.5. Это документирование действующего
решения, не смена URL или архитектуры. Telegram SDK/linking/auth пока нет.

## Альтернативы

Использовать только `(telegram)` как URL prefix нельзя: скобки исключаются
из URL. Отдельное Mini App приложение сейчас добавило бы второй Web runtime
и дублирование UI/transport composition; такое разделение не выбрано.

## Последствия

Будущие Mini App routes добавляются под явным сегментом telegram. Layout
не является проверкой auth/ownership. Domain/use cases остаются в packages;
переименование route group не должно незаметно менять публичный URL.
Общий root layout задаёт metadata, lang и skip-link для обеих оболочек.

## Проверка

LFS-109: production HTTP 200 для `/` и `/telegram`; `/(telegram)/telegram`
и неизвестный URL дают 404, POST health — 405. Health JSON/IDs/no-store
проверены по общему контракту; `pnpm verify` проходит.
Visual/keyboard/mobile проверка — NOT RUN: browser access host недоступен.
Полная приёмка: [Stage 1](../tasks/STAGE-01-ACCEPTANCE.md).
