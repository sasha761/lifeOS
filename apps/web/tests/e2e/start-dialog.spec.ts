import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { dashboardResponseSchema, goalsPageResponseSchema, onboardingStateResponseSchema } from "@lifeos/contracts";
import { login, noOverflow } from "./support.ts";

const firstVisit = (page: Page) => page.getByRole("dialog", { name: "Добро пожаловать в LifeOS" });
const spheres = (page: Page) => page.getByRole("heading", { name: "Сферы жизни", exact: true });
async function onboardingState(page: Page) {
  return onboardingStateResponseSchema.parse(await (await page.request.get("/api/v1/onboarding")).json()).data!;
}
async function goals(page: Page) {
  return goalsPageResponseSchema.parse(await (await page.request.get("/api/v1/goals?limit=100")).json()).data!.items;
}

/**
 * The first-visit popup on a fresh account per project (LFS-220): «✕» and Escape for the browser session, «Начать
 * настройку» → «Сохранить и выйти» → «Продолжить настройку», «Начать с чистого листа», then the same popup from Settings
 * with «Добавить пример» and the rhythm.
 */
test("first visit: close, questions saved and continued, a blank start, then the popup from Settings (LFS-220)", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await login(page, testInfo.project.name === "mobile" ? "START_MOBILE" : "START_DESKTOP");
  const start = firstVisit(page);
  await expect(start).toBeVisible();
  for (const name of ["Начать настройку", "Заполнить примером", "Начать с чистого листа"]) await expect(start.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(start).toContainText("Накопить 5 000 $");
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("start-dialog.png") });

  // «✕» and Escape close it until the next sign-in; the status on the server does not change.
  await start.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(start).toHaveCount(0);
  await page.reload();
  await expect(spheres(page)).toBeVisible();
  await expect(start).toHaveCount(0);
  expect((await onboardingState(page)).status).toBe("not_started");
  await page.evaluate(() => window.sessionStorage.clear());
  await page.reload();
  await expect(start).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(start).toHaveCount(0);
  await page.evaluate(() => window.sessionStorage.clear());
  await page.reload();

  // «Начать настройку» opens the questions; after «Сохранить и выйти» the popup offers to continue.
  await start.getByRole("button", { name: "Начать настройку", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("checkbox", { name: /^Финансы/ }).check();
  await page.getByRole("button", { name: "Сохранить и выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(start.getByRole("button", { name: "Продолжить настройку", exact: true })).toBeVisible();
  await expect(start.getByRole("button", { name: "Начать настройку", exact: true })).toHaveCount(0);
  expect(await onboardingState(page)).toMatchObject({ status: "in_progress", choice: "wizard" });

  // «Начать с чистого листа»: the popup no longer comes by itself.
  await start.getByRole("button", { name: "Начать с чистого листа", exact: true }).click();
  await expect(start).toHaveCount(0);
  await page.reload();
  await expect(spheres(page)).toBeVisible();
  await expect(start).toHaveCount(0);
  expect(await onboardingState(page)).toMatchObject({ status: "dismissed", choice: "blank" });

  // Settings → «Начальная настройка» opens the same popup at any time, with «Закрыть» instead of the blank start.
  await page.goto("/settings");
  const section = page.getByRole("region", { name: "Начальная настройка" });
  await expect(section).toContainText("отклонена");
  await expect(section).toContainText("Сейчас в аккаунте примеров нет.");
  await section.getByRole("button", { name: "Открыть начальную настройку", exact: true }).click();
  const reopened = page.getByRole("dialog", { name: "Что добавить в аккаунт?" });
  await expect(reopened).toBeVisible();
  await expect(reopened.getByRole("button", { name: "Начать с чистого листа" })).toHaveCount(0);
  await expect(reopened.getByRole("link", { name: "Начать вопросы", exact: true })).toHaveAttribute("href", "/onboarding");
  await noOverflow(page);
  await reopened.getByRole("button", { name: "Добавить пример", exact: true }).click();
  await expect(reopened).toHaveCount(0);
  await expect(section).toContainText("Пример добавлен: 7 целей");
  await expect(section).toContainText(/пройдена \S+ · 7 целей/);
  await expect(section.getByRole("button", { name: "Удалить все примеры", exact: true })).toBeVisible();

  // While example goals are in the account «Добавить пример» is inactive.
  await section.getByRole("button", { name: "Открыть начальную настройку", exact: true }).click();
  await expect(reopened).toContainText("Ваши 7 целей останутся как есть.");
  await expect(reopened.getByRole("button", { name: "Добавить пример", exact: true })).toBeDisabled();
  await expect(reopened.getByText("Пример уже в аккаунте", { exact: false }).filter({ visible: true })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(reopened).toHaveCount(0);
  await expect(section.getByRole("button", { name: "Открыть начальную настройку", exact: true })).toBeFocused();

  // «Ритм отметок» is stored on the profile.
  await section.getByRole("combobox", { name: "Ритм отметок" }).selectOption({ label: "Раз в неделю" });
  await section.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(section.getByText("Сохранено: Раз в неделю.", { exact: true })).toBeVisible();
  expect((await onboardingState(page)).checkin_rhythm).toBe("weekly");
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("settings-onboarding.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("first visit: «Заполнить примером», then «Пройти настройку вместо примера»; an account with goals sees no popup (LFS-220)", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await login(page, testInfo.project.name === "mobile" ? "START_EXAMPLE_MOBILE" : "START_EXAMPLE_DESKTOP");
  const start = firstVisit(page);
  await start.getByRole("button", { name: "Заполнить примером", exact: true }).click();
  await expect(start).toHaveCount(0);
  const banner = page.getByTestId("examples-banner");
  await expect(banner).toContainText(/7 целей и 7 измерений помечены «Пример»/);
  await expect(page.getByTestId(/^dashboard-domain-/).getByText("Пример", { exact: true }).filter({ visible: true })).toHaveCount(6);
  const loaded = await goals(page);
  expect(loaded.map(({ goal }) => goal.origin)).toEqual(Array(7).fill("starter"));
  expect(await onboardingState(page)).toMatchObject({ status: "completed", choice: "example" });
  await page.reload();
  await expect(banner).toBeVisible();
  await expect(start).toHaveCount(0);
  await noOverflow(page);

  // «Пройти настройку вместо примера»: confirmation, the examples are deleted and the questions open.
  await banner.getByRole("button", { name: "Пройти настройку вместо примера", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Пройти настройку вместо примера?" });
  await expect(confirm).toContainText("Удалим 7 примерных целей и откроем вопросы.");
  await expect(confirm.getByRole("button", { name: "Отмена", exact: true })).toBeFocused();
  await noOverflow(page);
  await confirm.getByRole("button", { name: "Удалить и открыть вопросы", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  expect(await goals(page)).toEqual([]);

  // An account with goals does not see the popup by itself (the fixture owner; a goal is added only if it has none yet).
  await login(page, "OWNER");
  const owner = dashboardResponseSchema.parse(await (await page.request.get("/api/v1/dashboard")).json()).data!;
  if (owner.domains.every((domain) => domain.activeCount + domain.archivedCount === 0)) {
    const created = await page.request.post("/api/v1/goals", { headers: { "idempotency-key": randomUUID() },
      data: { domain_key: "work", title: `Цель владельца · ${testInfo.project.name}`, unit: "count", baseline: "0", target: "3", direction: "increase" } });
    expect(created.status()).toBe(200);
  }
  await page.goto("/dashboard");
  await expect(spheres(page)).toBeVisible();
  await expect(firstVisit(page)).toHaveCount(0);
  const after = dashboardResponseSchema.parse(await (await page.request.get("/api/v1/dashboard")).json()).data!;
  expect(after.onboarding.show_start).toBe(false);
  expect(errors).toEqual([]);
});
