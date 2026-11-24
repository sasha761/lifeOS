import { test, expect } from "@playwright/test";
import { add, create, login, noOverflow, sphereRow } from "./support.ts";

const SPHERES = ["languages", "finance", "work", "projects", "skills", "health"] as const;

test("create goal → measurement → dashboard shows the same progress as goal details", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  const title = `Дашборд NOK · ${testInfo.project.name}`;
  await create(page, title);
  await add(page, "12000"); await expect(page.getByTestId("goal-percent")).toHaveText("24%");

  await page.goto("/dashboard");
  // «Сферы жизни» shows the newest active goal of each sphere in one row (mockup 04, LFS-213).
  const item = sphereRow(page, "finance", "Финансы", title);
  await expect(item.getByTestId("dashboard-goal-percent")).toHaveText("24%");
  await expect(item).toContainText(/12[\s,.]?000 из 50[\s,.]?000 NOK/);
  const latest = page.getByTestId("dashboard-activity").first();
  await expect(latest).toContainText("Добавлено измерение"); await expect(latest).toContainText(title); await expect(latest).toContainText("веб");
  await expect(page.getByTestId("dashboard-summary")).toBeVisible();

  // The row opens the sphere's goals; the goal itself is chosen in that list (beside the panel from 1024px).
  await item.getByRole("link", { name: `Финансы: ${title}`, exact: true }).click();
  await expect(page).toHaveURL(/\/goals\?domain_key=finance$/);
  await page.getByRole("region", { name: "Список целей" }).getByRole("link", { name: title, exact: true }).click();
  await expect(page).toHaveURL(/\/goals\/[0-9a-f-]{36}\?domain_key=finance$/);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await page.getByTestId("measurement-row").first().getByRole("button", { name: "Изменить", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Текущее значение, NOK", { exact: true }).fill("15000");
  await page.getByRole("button", { name: "Сохранить" }).click();
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
  // An empty account gets the first-visit popup (LFS-220); «✕» closes it for this browser session.
  const start = page.getByRole("dialog", { name: "Добро пожаловать в LifeOS" });
  await start.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(start).toHaveCount(0);
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
