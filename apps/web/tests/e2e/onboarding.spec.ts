import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { login, noOverflow } from "./support.ts";

const stepHeading = (page: Page) => page.locator("#onboarding-step-title");
async function next(page: Page) {
  await page.getByRole("button", { name: /^(Далее|К итогу)$/ }).click();
}

/**
 * The wizard on a fresh account per project (LFS-219): four spheres, answers with «Свой вариант», one skipped question,
 * «Сохранить и выйти» and reopening on the same step, then «Создать 4 цели» and the dashboard with the spheres in focus first.
 */
test("onboarding wizard: answers, own wording, a skip, save and resume, four goals without data (LFS-219)", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const mobile = testInfo.project.name === "mobile";
  await login(page, mobile ? "ONBOARDING_MOBILE" : "ONBOARDING_DESKTOP");
  await page.goto("/onboarding");

  // Step 1 (mockup 24): the step scale grows with the chosen spheres.
  await expect(stepHeading(page)).toHaveText("Какие сферы для вас важны в ближайшие полгода?");
  await next(page);
  await expect(page.getByText("Выберите хотя бы одну сферу.", { exact: true })).toBeVisible();
  for (const sphere of ["Финансы", "Проекты", "Навыки", "Здоровье"]) await page.getByRole("checkbox", { name: new RegExp(`^${sphere}`) }).check();
  await expect(page.getByText("Будет 4 вопроса по сферам, вопрос про ритм и итог.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Шаги настройки" }).getByRole("listitem")).toHaveCount(7);
  await noOverflow(page);
  await next(page);

  // Finance (mockup 25): a template and the numbers; the preview follows the input, the focus is on the question.
  await expect(stepHeading(page)).toHaveText("Какая у вас финансовая цель на ближайшие полгода?");
  await expect(stepHeading(page)).toBeFocused();
  await expect(page.getByRole("listitem").and(page.locator("[aria-current=step]"))).toContainText("Финансы");
  await page.getByRole("radio", { name: /^Создать подушку безопасности/ }).check();
  await page.getByLabel("Сколько нужно", { exact: true }).fill("60 000");
  await page.getByLabel("Сколько уже есть", { exact: true }).fill("5000");
  const preview = page.getByTestId("onboarding-preview");
  await expect(preview).toContainText("Подушка безопасности");
  // Grouping follows the account locale (the fixture uses en-GB): «5,000» or «5 000».
  await expect(preview).toContainText(/5[\s,.]000 → 60[\s,.]000 NOK/);
  await noOverflow(page);
  await next(page);

  // Projects: a template with a name of the person's own.
  await expect(stepHeading(page)).toHaveText("Какой личный проект вы хотите продвинуть?");
  await page.getByRole("radio", { name: /^Запустить новый/ }).check();
  await page.getByLabel(/^Название проекта/).fill("Сайт-портфолио");
  await page.getByLabel("Этапов всего", { exact: true }).fill("6");
  await expect(preview).toContainText("Запустить «Сайт-портфолио»");
  await next(page);

  // «Сохранить и выйти» keeps the draft on the server; the wizard reopens on the same step, «Назад» loses nothing.
  await expect(stepHeading(page)).toHaveText("Какой навык хотите прокачать?");
  await page.getByRole("button", { name: "Сохранить и выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/onboarding");
  await expect(stepHeading(page)).toHaveText("Какой навык хотите прокачать?");
  await page.getByRole("button", { name: "Назад", exact: true }).filter({ visible: true }).click();
  await expect(stepHeading(page)).toHaveText("Какой личный проект вы хотите продвинуть?");
  await expect(page.getByLabel(/^Название проекта/)).toHaveValue("Сайт-портфолио");
  await next(page);

  // Skills: skipped.
  await page.getByRole("button", { name: /^Пропустить/ }).click();

  // Health (mockup 26): two choices, one in the person's own words; a wrong number is shown at the field.
  await expect(stepHeading(page)).toHaveText("Что для вас главное в здоровье сейчас?");
  await page.getByRole("checkbox", { name: "Регулярные тренировки", exact: true }).check();
  await page.getByLabel("Цель", { exact: true }).fill("3");
  await page.getByRole("checkbox", { name: "Свой вариант", exact: true }).check();
  await page.getByLabel("Название цели", { exact: true }).fill("Проплыть 2 км без остановки");
  await page.getByLabel("Единица", { exact: true }).fill("метров за заплыв");
  await page.getByLabel("Сейчас", { exact: true }).fill("500");
  await page.getByLabel("Цель", { exact: true }).fill("400");
  await next(page);
  await expect(page.getByLabel("Цель", { exact: true })).toBeFocused();
  await expect(page.getByText("Цель должна быть больше значения «сейчас» и подходить единице.")).toBeVisible();
  await page.getByLabel("Цель", { exact: true }).fill("2000");
  await expect(page.getByTestId("onboarding-preview")).toContainText("Тренировки 3 раза в неделю");
  await expect(page.getByTestId("onboarding-preview")).toContainText("Проплыть 2 км без остановки");
  await noOverflow(page);
  await next(page);

  // Rhythm.
  await expect(stepHeading(page)).toHaveText("Как часто вы готовы отмечать прогресс?");
  await page.getByRole("radio", { name: /^2–3 раза в неделю/ }).check();
  await next(page);

  // Summary (mockup 27): four goals, the skipped sphere, nothing created yet.
  await expect(stepHeading(page)).toHaveText(/^Проверьте цели/);
  const goals = page.getByRole("list", { name: "Предложенные цели" });
  for (const title of ["Подушка безопасности", "Запустить «Сайт-портфолио»", "Тренировки 3 раза в неделю", "Проплыть 2 км без остановки"]) {
    await expect(goals.getByRole("checkbox", { name: `Создать цель «${title}»` })).toBeChecked();
  }
  await expect(page.getByTestId("onboarding-skipped-skills")).toContainText("Вопрос пропущен");
  await expect(page.getByText("Языки и Работа вы не выбрали.")).toBeVisible();
  expect((await (await page.request.get("/api/v1/goals")).json() as { data: { items: unknown[] } }).data.items).toHaveLength(0);
  await noOverflow(page);

  // «Изменить» opens the editor of the step; «+ Добавить цель в другой сфере» adds to the list, «Убрать» takes it back.
  await goals.getByRole("button", { name: "Изменить цель «Подушка безопасности»", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Изменить цель" });
  await edit.getByLabel("Сколько нужно", { exact: true }).fill("70000");
  await edit.getByRole("button", { name: "Готово", exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.getByTestId("onboarding-summary-finance.emergency_fund")).toContainText(/70[\s,.]000 NOK/);
  await page.getByRole("button", { name: "+ Добавить цель в другой сфере", exact: true }).click();
  const extra = page.getByRole("dialog", { name: "Цель в другой сфере" });
  await extra.getByRole("radio", { name: "Работа", exact: true }).check();
  await extra.getByLabel("Название", { exact: true }).fill("Отклики на вакансии");
  await extra.getByLabel("Единица", { exact: true }).selectOption("count");
  await extra.getByLabel("Цель", { exact: true }).fill("10");
  await extra.getByRole("button", { name: "Добавить в список", exact: true }).click();
  await expect(extra).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Создать 5 целей", exact: true })).toBeVisible();
  await goals.getByRole("button", { name: "Убрать цель «Отклики на вакансии»", exact: true }).click();
  await page.getByRole("button", { name: "Создать 4 цели", exact: true }).click();

  // Dashboard: four goals without data, the chosen spheres first, in registry order.
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("dashboard-summary")).toContainText("4 активные цели в 3 сферах");
  const order = await page.locator("[data-testid^=dashboard-domain-]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid")));
  expect(order.slice(0, 6)).toEqual(["finance", "projects", "skills", "health", "languages", "work"].map((key) => `dashboard-domain-${key}`));
  for (const key of ["finance", "projects", "health"]) await expect(page.getByTestId(`dashboard-domain-${key}`)).toContainText("Недостаточно данных");
  const created = await (await page.request.get("/api/v1/goals")).json() as { data: { items: { goal: { origin: string }; progress: { current: string | null } }[] } };
  expect(created.data.items).toHaveLength(4);
  expect(created.data.items.every(({ goal, progress }) => goal.origin === "onboarding" && progress.current === null)).toBe(true);
  await noOverflow(page);
  expect(errors).toEqual([]);
});
