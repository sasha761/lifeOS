import { test, expect } from "@playwright/test";
import { noOverflow } from "./support.ts";

// Open registration (LFS-221): the fixture server runs with AUTH_SIGNUP_MODE=open, so any new email can sign up.
test("guest finds registration on the sign-in page and creates an account with any email", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/auth/sign-in");
  await page.getByRole("link", { name: "Зарегистрироваться", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/sign-up$/);
  await expect(page.getByText("Создайте аккаунт, чтобы вести цели и следить за прогрессом.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Регистрация закрыта/)).toHaveCount(0);
  await noOverflow(page);

  const email = `newcomer-${testInfo.project.name}-${Date.now()}@example.test`;
  await page.getByLabel("Имя", { exact: true }).fill("Новый пользователь");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill("Open-signup-123");
  await page.getByLabel("Повторите пароль", { exact: true }).fill("Open-signup-123");
  await page.getByRole("button", { name: "Создать аккаунт", exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  // A brand-new account has no goals, so it meets the first-login popup (LFS-220).
  await expect(page.getByRole("dialog", { name: "Добро пожаловать в LifeOS" })).toBeVisible();
  const me = await page.request.get("/api/v1/me");
  expect(me.status()).toBe(200);
  expect(await me.json()).toMatchObject({ data: { email } });
  expect(errors).toEqual([]);
});
