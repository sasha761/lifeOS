import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { goalDetailsResponseSchema } from "@lifeos/contracts";
import { create, goalAction, login, noOverflow, openHistory } from "./support.ts";

// LFS-225 (mockups 32, 36): a goal without measurements is created through the API (its UI comes with LFS-227/228).
test("LFS-225 goal without measurements: list chip, panel, mark achieved and return; a numeric goal on pause", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  // On a phone the open goal is its own screen: the list is checked after returning to it.
  const desktop = testInfo.project.name === "desktop";
  await login(page);
  const title = `Без измерений · ${testInfo.project.name}`;
  const response = await page.request.post("/api/v1/goals", { headers: { "idempotency-key": randomUUID() },
    data: { kind: "unmeasured", domain_key: "projects", title, description: "Сайт и первые пользователи.", starts_at: "2026-11-01T00:00:00+01:00" } });
  expect(response.status()).toBe(200);
  const goal = goalDetailsResponseSchema.parse(await response.json()).data!.goal;

  await page.goto("/goals?domain_key=projects");
  const list = page.getByRole("region", { name: "Список целей" });
  const row = list.getByTestId("goal-row").filter({ has: page.getByRole("link", { name: title, exact: true }) });
  await expect(row.getByTestId("goal-row-progress")).toHaveText("В процессе");
  await expect(row).toContainText(/Проекты · с 01[./]11[./]2026/);
  await expect(row.locator("progress")).toHaveCount(0);
  await noOverflow(page);

  await row.getByRole("link", { name: title, exact: true }).click();
  await expect(page).toHaveURL(`/goals/${goal.id}?domain_key=projects`);
  const panel = page.getByRole("region", { name: title });
  await expect(panel.getByTestId("goal-meta")).toContainText("Проекты · без измерений");
  await expect(panel.getByTestId("goal-phase")).toContainText("В процессе");
  await expect(panel.getByTestId("goal-phase")).toContainText("Процента нет. Когда цель будет достигнута, отметьте её сами.");
  await expect(panel.getByText("Сайт и первые пользователи.")).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Измерения" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Добавить измерение" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("goal-in-progress.png"), fullPage: true });

  // The main button marks it achieved and becomes «Вернуть в работу»; focus stays on it.
  const main = panel.getByRole("button", { name: "✓ Отметить достигнутой", exact: true });
  await main.click();
  await expect(panel.getByTestId("goal-phase")).toContainText("✓ Достигнута");
  await expect(panel.getByTestId("goal-phase")).toContainText(/отмечена \d{2}[./]\d{2}[./]\d{4}/);
  await expect(panel.getByTestId("goal-phase")).toContainText("ручная отметка");
  const back = panel.getByRole("button", { name: "↺ Вернуть в работу", exact: true });
  await expect(back).toBeFocused();
  if (desktop) {
    await expect(row.getByTestId("goal-row-progress")).toHaveText("✓ Достигнута");
    await expect(row).toContainText(/Проекты · отмечена/);
  }
  await expect(await openHistory(page)).toContainText("Статус изменён: В процессе → Достигнута");
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("goal-achieved.png"), fullPage: true });

  await back.click();
  await expect(panel.getByTestId("goal-phase")).toContainText("В процессе");
  await expect(panel.getByRole("button", { name: "✓ Отметить достигнутой", exact: true })).toBeFocused();
  await expect(page.getByTestId("goal-history")).toContainText("Статус изменён: Достигнута → В процессе");

  // Every other move is in «⋯»; the menu has no definition for this goal to edit.
  await goalAction(page, "Поставить на паузу");
  await expect(panel.getByTestId("goal-phase")).toContainText(/На паузе.*на паузе с/);
  if (desktop) await expect(row.getByTestId("goal-row-progress")).toHaveText("На паузе");
  await goalAction(page, "Изменить цель");
  const dialog = page.getByRole("dialog", { name: "Изменить цель" });
  await expect(dialog.getByLabel("Дата начала · необязательно")).toHaveValue("2026-11-01");
  await expect(dialog.getByLabel("Единица")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Отмена" }).click();
  await page.goto("/goals?domain_key=projects");
  await expect(row.getByTestId("goal-row-progress")).toHaveText("На паузе");
  await expect(row).toContainText(/Проекты · с 01[./]11[./]2026/);

  // A numeric goal on pause: its percentage and measurements stay, the status is a chip by the title.
  const numeric = `Числовая на паузе · ${testInfo.project.name}`;
  await create(page, numeric);
  await page.getByRole("button", { name: "Действия с целью", exact: true }).click();
  await page.getByRole("button", { name: "Поставить на паузу", exact: true }).click();
  const numericPanel = page.getByRole("region", { name: numeric });
  await expect(numericPanel.getByText("На паузе", { exact: true })).toBeVisible();
  await expect(numericPanel.getByRole("button", { name: "Добавить измерение" })).toBeVisible();
  await page.goto("/goals?domain_key=finance");
  const numericRow = list.getByTestId("goal-row").filter({ has: page.getByRole("link", { name: numeric, exact: true }) });
  await expect(numericRow.getByText("На паузе", { exact: true })).toBeVisible();
  await expect(numericRow.getByTestId("goal-row-progress")).toContainText("Нет данных");
  expect(errors).toEqual([]);
});
