import { test, expect } from "@playwright/test";
import { add, create, login, noOverflow } from "./support.ts";

const SPHERES = ["languages", "finance", "work", "projects", "skills", "health"] as const;

test("create goal → measurement → dashboard shows the same progress as goal details", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  const title = `Дашборд NOK · ${testInfo.project.name}`;
  await create(page, title);
  await add(page, "12000"); await expect(page.getByTestId("goal-percent")).toHaveText("24%");

  await page.goto("/dashboard");
  const item = page.getByTestId("dashboard-domain-finance").getByTestId("dashboard-goal").filter({ has: page.getByRole("link", { name: title, exact: true }) });
  await expect(item.getByTestId("dashboard-goal-percent")).toHaveText("24%");
  await expect(item).toContainText(/12[\s,.]?000 NOK \/ 50[\s,.]?000 NOK/);
  const latest = page.getByTestId("dashboard-activity").first();
  await expect(latest).toContainText("Добавлено измерение"); await expect(latest).toContainText(title); await expect(latest).toContainText("веб");
  await expect(page.getByTestId("dashboard-summary")).toBeVisible();

  await item.getByRole("link", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await page.getByTestId("measurement-row").first().getByRole("button", { name: "Изменить", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Значение (NOK)", { exact: true }).fill("15000");
  await page.getByRole("button", { name: "Подтвердить изменения измерения" }).click();
  await expect(page.getByTestId("goal-percent")).toHaveText("30%");

  await page.goto("/dashboard");
  await expect(item.getByTestId("dashboard-goal-percent")).toHaveText("30%");
  await expect(page.getByTestId("dashboard-activity").first()).toContainText("Исправлено измерение");
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("dashboard-owner.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("empty and foreign dashboards show six spheres without fabricated progress or other users' actions", async ({ page }, testInfo) => {
  await login(page, "EMPTY");
  for (const key of SPHERES) await expect(page.getByTestId(`dashboard-domain-${key}`)).toContainText("Нет целей");
  await expect(page.getByTestId(/^dashboard-domain-/)).toHaveCount(6);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.getByText("%")).toHaveCount(0);
  await expect(page.getByText("Действий пока нет", { exact: false })).toBeVisible();
  await expect(page.getByTestId("dashboard-domain-health").getByRole("link", { name: "Создать цель", exact: true })).toHaveAttribute("href", "/goals/new?domain_key=health");
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("dashboard-empty.png"), fullPage: true });

  await login(page, "OTHER");
  await expect(page.getByRole("heading", { name: "Сферы жизни", exact: true })).toBeVisible();
  await expect(page.getByText(`Дашборд NOK · ${testInfo.project.name}`)).toHaveCount(0);
  await expect(page.getByTestId("dashboard-activity")).toHaveCount(0);
});
