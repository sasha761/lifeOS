import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export async function login(page: Page, user = "OWNER") {
  // Real DB-backed sessions seeded by Better Auth; repeated sign-in/rate-limit testing is LFS-201.
  const cookie = process.env[`LFS208_E2E_${user}_COOKIE`]!;
  const separator = cookie.indexOf("=");
  await page.context().addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: process.env.LFS208_E2E_BASE_URL! }]);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
}
export async function create(page: Page, title: string, baseline = "0", target = "50000") {
  await page.goto("/goals/new");
  await page.getByLabel("Название цели", { exact: true }).fill(title);
  await page.getByLabel("Сфера", { exact: true }).selectOption("finance");
  await page.getByLabel("Начальное значение", { exact: true }).fill(baseline);
  await page.getByLabel("Целевое значение", { exact: true }).fill(target);
  await page.getByRole("button", { name: "Создать цель", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.getByText("Недостаточно данных", { exact: true })).toBeVisible();
  return new URL(page.url()).pathname;
}
export async function add(page: Page, value: string, note = "Браузерное измерение") {
  await page.getByRole("button", { name: "Добавить измерение", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Значение (NOK)", { exact: true }).fill(value);
  await dialog.getByLabel("Заметка (необязательно)").fill(note);
  await dialog.getByRole("button", { name: "Добавить измерение", exact: true }).click();
}
export async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}
