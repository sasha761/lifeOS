import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { add, create, login, noOverflow, signInWithForm } from "./support.ts";

// Stage 2 acceptance in the browser (LFS-209): the main flow through the real sign-in form, the progress formulas
// on screen against the API, and a manual goal in each of the six spheres.
const SPHERES = [["languages", "Языки"], ["finance", "Финансы"], ["work", "Работа"], ["projects", "Проекты"], ["skills", "Навыки"], ["health", "Здоровье"]] as const;

type GoalProgressView = { current: string | null; progressPercent: number | null; measurementCount: number; status: string; methodology: { clamped: boolean } };
/** The same goal through `GET /api/v1/goals/:id` with the page's session: the numbers on screen must equal these. */
async function apiProgress(page: Page, goalPath: string): Promise<GoalProgressView> {
  const response = await page.request.get(`/api/v1${goalPath}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: { progress: GoalProgressView } }).data.progress;
}
function dashboardGoal(page: Page, domainKey: string, title: string) {
  return page.getByTestId(`dashboard-domain-${domainKey}`).getByTestId("dashboard-goal").filter({ has: page.getByRole("link", { name: title, exact: true }) });
}
/** `datetime-local` value at noon `days` days ago in the owner's time zone (Europe/Oslo in the fixture). */
function osloNoon(days: number): string {
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - days * 86_400_000));
  return `${date}T12:00`;
}

test("guest signs in with the form, the dashboard follows create/edit/delete of a measurement, sign-out revokes the session", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/auth\/sign-in\?next=(%2F|\/)dashboard$/);
  await noOverflow(page);
  await signInWithForm(page);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText(process.env.LFS209_E2E_OWNER_EMAIL!, { exact: true })).toBeVisible();

  const title = `Сквозной сценарий · ${testInfo.project.name}`;
  const path = await create(page, title);
  await add(page, "12000"); await expect(page.getByTestId("goal-percent")).toHaveText("24%");
  expect(await apiProgress(page, path)).toMatchObject({ current: "12000", progressPercent: 24, measurementCount: 1 });
  await page.goto("/dashboard");
  const item = dashboardGoal(page, "finance", title);
  await expect(item.getByTestId("dashboard-goal-percent")).toHaveText("24%");
  await expect(item).toContainText(/12[\s,.]?000 из 50[\s,.]?000 NOK/);
  await expect(page.getByTestId("dashboard-activity").first()).toContainText("Добавлено измерение");

  await item.getByRole("link", { name: title, exact: true }).click();
  const row = page.getByTestId("measurement-row").first();
  await row.getByRole("button", { name: "Изменить", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Значение (NOK)", { exact: true }).fill("15000");
  await page.getByRole("button", { name: "Подтвердить изменения измерения" }).click();
  await expect(page.getByTestId("goal-percent")).toHaveText("30%");
  await page.goto("/dashboard");
  await expect(item.getByTestId("dashboard-goal-percent")).toHaveText("30%");
  await expect(page.getByTestId("dashboard-activity").first()).toContainText("Исправлено измерение");

  await item.getByRole("link", { name: title, exact: true }).click();
  await row.getByRole("button", { name: "Удалить", exact: true }).click();
  await page.getByRole("button", { name: "Подтвердить удаление" }).click();
  await expect(page.getByTestId("measurement-row")).toHaveCount(0);
  await expect(page.getByText("Недостаточно данных", { exact: true })).toBeVisible();
  expect(await apiProgress(page, path)).toMatchObject({ current: null, progressPercent: null, measurementCount: 0, status: "insufficient_data" });
  await page.goto("/dashboard");
  await expect(item).toContainText("Недостаточно данных");
  await expect(item.getByTestId("dashboard-goal-percent")).toHaveCount(0);
  await expect(item.getByRole("progressbar")).toHaveCount(0);
  const latest = page.getByTestId("dashboard-activity").first();
  await expect(latest).toContainText("Удалено измерение"); await expect(latest).toContainText(title);
  await noOverflow(page);

  const session = (await page.context().cookies()).find((cookie) => cookie.name.endsWith(".session_token"));
  expect(session).toBeDefined();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
  expect((await page.context().cookies()).some((cookie) => cookie.name.endsWith(".session_token"))).toBe(false);
  await page.goto("/goals");
  await expect(page).toHaveURL(/\/auth\/sign-in\?next=/);
  // The old cookie is refused by the server: sign-out revoked the session itself, not only the browser cookie.
  const replayed = await page.request.get("/api/v1/dashboard", { headers: { cookie: `${session!.name}=${session!.value}` } });
  expect(replayed.status()).toBe(401);
  expect(await replayed.json()).toMatchObject({ data: null, errors: [{ code: "UNAUTHORIZED" }] });

  // Only the form session ended: the owner's other session and the saved goal are intact.
  await login(page);
  await expect(dashboardGoal(page, "finance", title)).toContainText("Недостаточно данных");
  expect(errors).toEqual([]);
});

test("debt, a backdated measurement and an over-target value show the API's numbers", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  const percent = page.getByTestId("goal-percent");
  const values = page.getByTestId("goal-values");
  const rows = page.getByTestId("measurement-row");

  const debtPath = await create(page, `Долг 100 000 NOK · ${testInfo.project.name}`, "100000", "0", { decrease: true });
  await add(page, "80000", "Текущий остаток");
  await expect(percent).toHaveText("20%");
  await expect(values).toContainText(/80[\s,.]?000 NOK из 0 NOK/);
  // Entered later but measured two days earlier: it joins the history without becoming the current value.
  await add(page, "90000", "Остаток позавчера", osloNoon(2));
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Текущий остаток");
  await expect(rows.nth(1)).toContainText("Остаток позавчера");
  await expect(percent).toHaveText("20%");
  await expect(values).toContainText(/80[\s,.]?000 NOK из 0 NOK/);
  expect(await apiProgress(page, debtPath)).toMatchObject({ current: "80000", progressPercent: 20, measurementCount: 2, status: "measured" });

  const overTitle = `Сверх цели 50 000 NOK · ${testInfo.project.name}`;
  const overPath = await create(page, overTitle);
  await add(page, "60000");
  await expect(percent).toHaveText("100%");
  await expect(values).toContainText(/60[\s,.]?000 NOK из 50[\s,.]?000 NOK/);
  expect(await apiProgress(page, overPath)).toMatchObject({ current: "60000", progressPercent: 100, methodology: { clamped: true } });
  await page.goto("/dashboard");
  const over = dashboardGoal(page, "finance", overTitle);
  await expect(over.getByTestId("dashboard-goal-percent")).toHaveText("100%");
  await expect(over).toContainText(/60[\s,.]?000 из 50[\s,.]?000 NOK/);
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test("a manual goal can be created in each of the six spheres and lands in its card without invented progress", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  const titles = SPHERES.map(([, label]) => `${label}: ручная цель · ${testInfo.project.name}`);
  for (const [index, [, label]] of SPHERES.entries()) await create(page, titles[index]!, "0", "10", { domain: label });
  await page.goto("/dashboard");
  await expect(page.getByTestId(/^dashboard-domain-/)).toHaveCount(6);
  for (const [index, [key]] of SPHERES.entries()) {
    const item = dashboardGoal(page, key, titles[index]!);
    await expect(item).toContainText("Недостаточно данных");
    await expect(item.getByTestId("dashboard-goal-percent")).toHaveCount(0);
    await expect(item.getByRole("progressbar")).toHaveCount(0);
  }
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("dashboard-six-spheres.png"), fullPage: true });
  expect(errors).toEqual([]);
});
