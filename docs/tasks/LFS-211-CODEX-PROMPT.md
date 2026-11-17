# Промпт для Codex — LFS-211 (Design System v2)

```text
Работаем над проектом LifeOS в папке C:\OSPanel\home\lifeOS.loc.

Перед изменениями:
1. Изучи AGENTS.md, apps/web/AGENTS.md, docs/adr/011-design-system-v2.md, docs/tasks/LFS-211.md,
   docs/reference/LifeOS_Design_Tasks_Jobs_v0.2.md (раздел 16) и docs/reference/ui/README.md.
2. Открой картинки docs/reference/ui/01-main.png, 02-today.png и 04-progress.png: это визуальный ориентир
   (палитра, шрифт, верхняя полоса с pill-кнопками, pill-переключатели, карточки). Данные на картинках
   примерные — не переносить их в код.
3. Проверь git status, текущий apps/web/app/globals.css, (web)/layout.tsx и существующие Playwright-тесты LFS-208.

Выполни ТОЛЬКО LFS-211: перевод существующего UI на тёмную тему, Inter и новую оболочку
без изменения поведения, URL, API и схемы БД. Не создавай экраны будущих модулей (задачи, календарь,
проекты, поиск работы, ассистент) и не начинай LFS-204.

После выполнения покажи: изменённые файлы, выбранный способ подключения Inter, реальные команды и
результаты (pnpm verify, Playwright), скриншоты 1280px и 390px из acceptance criteria, проверку контраста,
git diff --stat и git status --short. Обнови раздел «Проверка» в ADR-011.
НЕ переходи к LFS-204 без моего разрешения.
```

## После LFS-211: дополнение к промпту LFS-204

Добавить в обычный промпт LFS-204 одну строку:

```text
Dashboard оформи в стиле Design System v2 (ADR-011) по образцу docs/reference/ui/04-progress.png,
но только с данными Stage 2: цели по сферам с прогрессом и источником, последние действия
из activity_events, «Сегодня» — цели со сроком. Серии, задачи, рекорды и достижения с макета
НЕ реализовывать и не имитировать: они появятся в модуле Tasks (этапы 9–10).
```
