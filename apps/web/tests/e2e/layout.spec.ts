import { test, expect } from "@playwright/test";
import { create, goalAction, login, noOverflow, openHistory } from "./support.ts";

// Page layout per mockups (LFS-213): /goals list and goal panel (09), date-only deadline (10), sphere page (10).
const desktop = (name: string) => name === "desktop";

test("goals list and the chosen goal sit side by side; choosing keeps the list, filters and focus", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  const older = `Список: первая · ${testInfo.project.name}`;
  const newer = `Список: вторая · ${testInfo.project.name}`;
  const olderPath = await create(page, older, "0", "100", { domain: "Проекты" });
  await create(page, newer, "0", "100", { domain: "Проекты" });

  await page.goto("/goals?domain_key=projects");
  const list = page.getByRole("region", { name: "Список целей" });
  const panelTitle = (title: string) => page.getByRole("heading", { name: title, exact: true, level: 2 });
  await expect(list.getByRole("link", { name: newer, exact: true })).toBeVisible();
  if (desktop(testInfo.project.name)) {
    // Without an id the newest (first) goal of the list is shown beside it and marked as chosen.
    await expect(panelTitle(newer)).toBeVisible();
    await expect(list.getByRole("link", { name: newer, exact: true })).toHaveAttribute("aria-current", "true");
    const link = list.getByRole("link", { name: older, exact: true });
    await link.focus(); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${olderPath}\\?domain_key=projects$`));
    await expect(panelTitle(older)).toBeVisible();
    await expect(link).toHaveAttribute("aria-current", "true");
    await expect(link).toBeFocused();
    await expect(list.getByRole("link", { name: newer, exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Сфера целей" }).getByRole("link", { name: "Проекты", exact: true })).toHaveAttribute("aria-current", "page");
    // «⋯» is a disclosure: Tab reaches its commands, Escape closes it and returns focus to the toggle.
    const toggle = page.getByRole("button", { name: "Действия с целью", exact: true });
    await toggle.focus(); await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    // The phase moves come first (LFS-225); a goal in progress starts with «Поставить на паузу».
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Поставить на паузу", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
  } else {
    // Narrow screens: the list and the goal are separate screens, with «Все цели» back to the same filter.
    await expect(panelTitle(newer)).toBeHidden();
    await list.getByRole("link", { name: older, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${olderPath}\\?domain_key=projects$`));
    await expect(panelTitle(older)).toBeVisible();
    await expect(list).toBeHidden();
    await page.getByRole("link", { name: "Все цели", exact: true }).click();
    await expect(page).toHaveURL(/\/goals\?domain_key=projects$/);
    await expect(list.getByRole("link", { name: older, exact: true })).toBeVisible();
  }
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("goals-browser.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("the deadline is a date: stored as the end of that day and kept when only the title changes", async ({ page }, testInfo) => {
  await login(page);
  const title = `Срок датой · ${testInfo.project.name}`;
  await page.goto("/goals/new");
  await page.getByRole("radio", { name: "Навыки", exact: true }).check();
  await page.getByLabel("Название", { exact: true }).fill(title);
  await page.getByLabel("Цель", { exact: true }).fill("10");
  await page.getByLabel("Срок · необязательно", { exact: true }).fill("2027-01-15");
  await page.getByRole("button", { name: "Добавить описание" }).click();
  await expect(page.getByLabel("Описание (необязательно)")).toBeFocused();
  await page.getByRole("button", { name: "Создать цель", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  const path = new URL(page.url()).pathname;
  const dueAt = async () => ((await (await page.request.get(`/api/v1${path}`)).json()) as { data: { goal: { due_at: string } } }).data.goal.due_at;
  // The fixture owner is in Europe/Oslo (UTC+1 in January).
  expect(await dueAt()).toBe("2027-01-15T22:59:59.999Z");
  await expect(page.getByRole("region", { name: title }).getByText(/до 15\.01\.2027|до 15\/01\/2027/)).toBeVisible();
  await goalAction(page, "Изменить цель");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Срок · необязательно", { exact: true })).toHaveValue("2027-01-15");
  await dialog.getByLabel("Название", { exact: true }).fill(`${title} · ред.`);
  await page.getByRole("button", { name: "Сохранить изменения цели" }).click();
  await expect(page.getByRole("heading", { name: `${title} · ред.`, exact: true })).toBeVisible();
  expect(await dueAt()).toBe("2027-01-15T22:59:59.999Z");
  await expect(await openHistory(page)).toContainText("Название изменено");
});

test("a sphere page shows the owner's goals and the sphere journal, a guest only the public text", async ({ page, browser }, testInfo) => {
  await login(page);
  const title = `Сфера здоровья · ${testInfo.project.name}`;
  await create(page, title, "0", "10", { domain: "Здоровье" });
  await page.getByRole("button", { name: "Добавить измерение", exact: true }).click();
  await page.getByRole("dialog").getByLabel(/^Значение/).fill("4");
  await page.getByRole("dialog").getByRole("button", { name: "Добавить измерение", exact: true }).click();
  await expect(page.getByTestId("goal-percent")).toHaveText("40%");

  await page.goto("/domains/health");
  await expect(page.getByRole("heading", { name: "Здоровье", level: 1 })).toBeVisible();
  await expect(page.getByTestId("domain-goal").first()).toContainText(title);
  await expect(page.getByTestId("domain-goal").first()).toContainText("40%");
  const journal = page.getByTestId("domain-activity");
  await expect(journal.getByRole("listitem").first()).toContainText(`Добавлено измерение «${title}»`);
  await expect(page.getByRole("heading", { name: "Специализированный модуль появится позже" })).toBeVisible();
  await noOverflow(page);

  const guest = await browser.newContext({ baseURL: process.env.LFS208_E2E_BASE_URL });
  try {
    const anonymous = await guest.newPage();
    await anonymous.goto("/domains/health");
    await expect(anonymous.getByText("Прогресс строится по вашим измерениям.", { exact: false })).toBeVisible();
    await expect(anonymous.getByText(title)).toHaveCount(0);
    await expect(anonymous.getByTestId("domain-activity")).toHaveCount(0);
  } finally { await guest.close(); }
});
