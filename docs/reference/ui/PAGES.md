# Страницы LifeOS: полный список и покрытие макетами

Составлено 17.11.2026 по [мастер-плану v0.4](../LifeOS_Master_Plan_v0.4.md) (этапы 2–8, API §8),
[спеке дизайна, Tasks и Job Search v0.2](../LifeOS_Design_Tasks_Jobs_v0.2.md) (§17.2, §18.6) и фактическим
маршрутам `apps/web/app`. Маршруты будущих этапов — предложение; окончательно их фиксирует задача этапа.

Обозначения: **код** — страница уже есть в `apps/web`; **макет** — файл в этой папке.

## Этап 2 — LifeOS Core (код есть)

| Маршрут | Страница | Задачи | Макет |
|---|---|---|---|
| `/` | Обзор | LFS-103, 204 | `04-progress.png` (компоновка), `01-main.png` (стиль) |
| `/dashboard` | Dashboard шести сфер | LFS-204 | `04-progress.png`, только данные Stage 2 |
| `/goals` | Список целей | LFS-208 | `09-goals.png` |
| `/goals/[id]` | Цель: прогресс, замеры, история | LFS-206–208, 210 | `09-goals.png`, правая панель |
| `/goals/new` | Новая цель | LFS-208 | `10-domain-new-goal.png`, диалог |
| `/domains/[domainKey]` | Страница сферы | LFS-203 | `10-domain-new-goal.png` |
| `/settings` | Профиль, часовой пояс, язык | LFS-202 | `16-settings.png` |
| `/auth/sign-in`, `/auth/sign-up`, `/auth/forgot-password`, `/auth/reset-password` | Вход и восстановление | LFS-201 | отдельного макета нет: форма и карточка из `01-main.png`, оформлено в LFS-211 |
| `error`, `not-found`, `loading` | Служебные состояния | LFS-103 | `01-main.png`, оформлено в LFS-211 |

## Первый вход (решение владельца 18.11.2026)

Подробно: [ONBOARDING.md](ONBOARDING.md). Пример больше не создаётся автоматически.

| Маршрут | Страница | Задачи | Макет |
|---|---|---|---|
| `/dashboard`, диалог | Попап первого входа: пример, настройка или чистый лист | LFS-220 | `23-onb-start.png`, `29-onb-mobile.png` |
| `/onboarding` | Мастер: сферы, вопрос на сферу, ритм, итог | LFS-219 | `24-onb-spheres.png` – `27-onb-summary.png`, `29-onb-mobile.png` |
| `/dashboard` с примером | Метки «Пример», баннер, «Удалить все примеры» | LFS-218 | `28-onb-example.png` |
| `/settings` → Начальная настройка | Кнопка открытия попапа, ритм, сферы в фокусе, примеры | LFS-220 | `30-onb-settings.png`, `31-onb-reopen.png` |

## Этапы 3–8 — MVP (кода нет)

| Маршрут | Страница | Этап и задачи | Макет |
|---|---|---|---|
| `/settings` → Telegram | Привязка Telegram, отвязка | 3: LFS-302 | `16-settings.png` |
| — | Чат с ботом в самом Telegram | 3–4 | не нужен: интерфейс Telegram |
| `/languages` | Список языков (профили) | 4: LFS-401 | `11-languages.png`, переключатель профилей сверху |
| `/languages/[id]` | Профиль языка и честная статистика | 4: LFS-409; 6: LFS-607–609; 8: LFS-804 | `11-languages.png` |
| `/languages/[id]/tutor` | Чат с Tutor | 4: LFS-404–406; 8: LFS-801–803 | `12-tutor.png` |
| `/languages/[id]/vocabulary` | Словарь | 4: LFS-408; 5: LFS-507 | `13-vocabulary.png` |
| `/languages/[id]/lessons` | История уроков | 6: LFS-605 | блок «Последние уроки» в `11-languages.png` + таблица по образцу `13-vocabulary.png` |
| `/lessons/[id]` | Урок: задания, оценка, ошибки, спор | 6: LFS-601–606 | `14-lesson.png` |
| `/telegram`, `/telegram/review`, `/telegram/vocabulary`, `/telegram/profile` | Mini App | 5: LFS-501–508 | `17-miniapp.png` (профиль — по образцу настроек) |
| `/assistant` | Центральный ассистент | 7: LFS-702–709 | `15-assistant.png` |
| `/settings` → Приватность | Экспорт JSON, хранение переписки, удаление аккаунта | 8: LFS-805 | `16-settings.png` |

## После MVP — Tasks и Job Search (спека §17–18)

| Маршрут | Страница | Этап | Макет |
|---|---|---|---|
| `/progress` | Мой прогресс | 9–10 | `04-progress.png` |
| `/tasks?view=today` | Сегодня | 9 | `02-today.png` |
| `/tasks?view=calendar` | Неделя | 10 | `05-calendar.png` |
| `/tasks?view=all` | Все задачи | 9 | `18-tasks-all.png` |
| `/tasks?view=trash` | Корзина | 9 | вкладка в `18-tasks-all.png`, тот же список |
| `/tasks/[id]` | Детали задачи | 9 | `06-taskdetails.png` |
| `/projects` | Проекты | 9 | `07-projects.png` |
| `/projects/[id]` | Проект: Обзор, Доска, Задачи, История, Инфо, Файлы | 9 | `19-project-board.png` (Доска); Задачи — как `18-tasks-all.png` |
| `/work/job-search` | Воронка откликов | 11–12 | `03-jobsearch.png`, `08-interview.png` |
| `/work/job-search/review` | Пакетное ревью писем | 12 | `20-job-review.png` |
| `/work/resumes` | Резюме | 11 | `21-resumes.png` |
| `/work/job-search/settings` | Настройки поиска и автономии | 11–12 | `22-job-settings.png` |

## Что сознательно не нарисовано

- **Finance, Health, Skills, Integrations Hub, SaaS** (мастер-план §11): для них ещё нет спеки,
  макет был бы выдумкой. До своих модулей эти сферы живут на странице сферы (`10-domain-new-goal.png`).
- **Светлая тема** — отложена в ADR-011.

## Открытый вопрос: итоговая навигация

Сейчас (LFS-211): «Обзор, Цели, Сферы ▾, Telegram, Кабинет, Настройки». На макетах MVP: «Обзор, Цели, Сферы, Языки, Ассистент».
На макетах после MVP: «Мой прогресс, Задачи, Проекты, Ассистент».
Предложение на момент появления Tasks: **«Мой прогресс, Задачи, Проекты, Сферы ▾ (Языки, Финансы, Работа…), Ассистент, ⚙»**,
а «Цели» — вкладка внутри «Мой прогресс» и страниц сфер. Решение записать в ADR, когда начнётся этап 9.
