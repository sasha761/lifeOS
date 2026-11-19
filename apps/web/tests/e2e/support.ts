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
/** Signs the fixture owner in through the real form (LFS-209); this creates a separate session from the seeded cookie. */
export async function signInWithForm(page: Page) {
  await page.getByLabel("Email", { exact: true }).fill(process.env.LFS209_E2E_OWNER_EMAIL!);
  await page.getByLabel("Пароль", { exact: true }).fill(process.env.LFS209_E2E_OWNER_PASSWORD!);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
}
export async function create(page: Page, title: string, baseline = "0", target = "50000", { domain = "Финансы", decrease = false } = {}) {
  await page.goto("/goals/new");
  await page.getByRole("radio", { name: domain, exact: true }).check();
  await page.getByLabel("Название", { exact: true }).fill(title);
  if (decrease) await page.getByRole("radio", { name: "Уменьшить до значения", exact: true }).check();
  await page.getByLabel("Старт", { exact: true }).fill(baseline);
  await page.getByLabel("Цель", { exact: true }).fill(target);
  await page.getByRole("button", { name: "Создать цель", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.getByText("Недостаточно данных", { exact: true })).toBeVisible();
  return new URL(page.url()).pathname;
}
/** `measuredAt` is a `datetime-local` value in the owner's time zone; without it the dialog keeps «now». */
export async function add(page: Page, value: string, note = "Браузерное измерение", measuredAt?: string) {
  await page.getByRole("button", { name: "Добавить измерение", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Значение (NOK)", { exact: true }).fill(value);
  if (measuredAt) await dialog.getByLabel("Дата и время измерения", { exact: true }).fill(measuredAt);
  await dialog.getByLabel("Заметка (необязательно)").fill(note);
  await dialog.getByRole("button", { name: "Добавить измерение", exact: true }).click();
}
/** Commands of the goal panel live in its «⋯» menu (mockup 09, LFS-213). */
export async function goalAction(page: Page, name: "Изменить цель" | "В архив" | "Удалить цель") {
  await page.getByRole("button", { name: "Действия с целью", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
}
/** Row of a sphere in «Сферы жизни» showing the given goal as its newest active one (mockup 04, LFS-213). */
export function sphereRow(page: Page, key: string, label: string, title: string) {
  return page.getByTestId(`dashboard-domain-${key}`).filter({ has: page.getByRole("link", { name: `${label}: ${title}`, exact: true }) });
}
export async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}
