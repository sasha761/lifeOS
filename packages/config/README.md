# @lifeos/config

Общий strict tsconfig, TypeScript ESLint flat config и серверная env validation.
Tooling exports: `@lifeos/config/tsconfig/base.json`, `@lifeos/config/eslint/base`.
Они загружаются напрямую без runtime env и без отдельной сборки.

`@lifeos/config/env` — отдельный Node ESM export (`dist/env.js` и declarations),
собираемый TypeScript. Он предоставляет Zod-схемы и `readWebEnv`,
`readWorkerEnv`, `readDatabaseEnv`, `parseDatabaseUrl`. Импорт безопасен без
credentials; validation происходит при явном вызове. Модуль предназначен
для Node и зависит от `node:process`. Правила и startup wiring —
[API-контракт](../../docs/api/contracts.md#env-и-запуск).

Ошибка конфигурации содержит только имена настроек и фиксированные
диагностические сообщения, без исходного ввода/cause. CLI и HTTP-адаптеры
не должны логировать возвращённые конфиги или сырые Zod errors.

Root lint/typecheck/test/build включают runtime export. Для отдельной suite:
`pnpm --filter @lifeos/config test`. Версии закреплены в
[ADR-001](../../docs/adr/001-stack.md).
