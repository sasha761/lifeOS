import { test, expect } from "@playwright/test";
import { add, create, goalAction, login, noOverflow } from "./support.ts";

test("guest guards and the empty state", async ({ page }) => {
  for (const path of ["/goals", "/goals/new", "/goals/4fe63a56-7a7f-4905-bdc3-c9dff1d439dc"]) {
    await page.goto(path); await expect(page).toHaveURL(/\/auth\/sign-in\?next=/);
  }
  await login(page, "EMPTY"); await page.goto("/goals");
  await expect(page.getByRole("heading", { name: "Целей пока нет" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Создать цель", exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await noOverflow(page);
});

test("create, measure 24%, edit, cancel/delete, metadata and archive keep history", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  const title = `Накопить 50 000 NOK · ${testInfo.project.name}`;
  const path = await create(page, title);
  await add(page, "12000"); await expect(page.getByTestId("goal-percent")).toHaveText("24%");
  const first = page.getByTestId("measurement-row").first();
  await first.getByRole("button", { name: "Изменить", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Значение (NOK)", { exact: true }).fill("15000");
  await page.getByRole("button", { name: "Подтвердить изменения измерения" }).click();
  await expect(page.getByTestId("goal-percent")).toHaveText("30%");
  await first.getByRole("button", { name: "Удалить", exact: true }).click();
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(page.getByTestId("measurement-row")).toHaveCount(1);
  await add(page, "20000", "Временная запись"); await expect(page.getByTestId("measurement-row")).toHaveCount(2);
  const temporary = page.getByTestId("measurement-row").filter({ hasText: "Временная запись" });
  await temporary.getByRole("button", { name: "Удалить", exact: true }).click();
  await page.getByRole("button", { name: "Подтвердить удаление" }).click();
  await expect(page.getByTestId("measurement-row")).toHaveCount(1);
  await expect(page.getByTestId("goal-percent")).toHaveText("30%");
  await goalAction(page, "Изменить цель");
  await page.getByRole("dialog").getByLabel("Название", { exact: true }).fill(`${title} · исправлена`);
  await page.getByRole("button", { name: "Сохранить изменения цели" }).click();
  await expect(page.getByRole("heading", { name: `${title} · исправлена`, exact: true })).toBeVisible();
  await goalAction(page, "В архив");
  await page.getByRole("button", { name: "Подтвердить архивирование" }).click();
  await expect(page.getByRole("region", { name: `${title} · исправлена` }).getByText("В архиве", { exact: true })).toBeVisible();
  await expect(page.getByTestId("measurement-row")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Добавить измерение", exact: true })).toHaveCount(0);
  await noOverflow(page);
  // «Все цели» is the narrow-screen way back (covered in layout.spec.ts); the list is beside the panel from 1024px.
  await page.goto("/goals");
  const domainTabs = page.getByRole("navigation", { name: "Сфера целей" });
  await domainTabs.getByRole("link", { name: "Финансы", exact: true }).click();
  await expect(page).toHaveURL(/\/goals\?domain_key=finance$/);
  await expect(domainTabs.getByRole("link", { name: "Финансы", exact: true })).toHaveAttribute("aria-current", "page");
  const statusTabs = page.getByRole("navigation", { name: "Статус целей" });
  await statusTabs.getByRole("link", { name: /^В архиве/ }).click();
  await expect(page).toHaveURL(/\/goals\?domain_key=finance&status=archived$/);
  await expect(statusTabs.getByRole("link", { name: /^В архиве/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: `${title} · исправлена`, exact: true })).toBeVisible();
  await noOverflow(page);
  await login(page, "OTHER"); await page.goto(path);
  await expect(page.getByText("Запись не найдена или недоступна.", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(`${title} · исправлена`, { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("«Новая цель» opens as a dialog over the current page, closes back to it and creates the goal (LFS-212)", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await login(page); await page.goto("/domains/finance");
  const open = page.getByRole("link", { name: "Цель в сфере", exact: true });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Новая цель" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/goals\/new\?domain_key=finance$/);
  await expect(page.locator("main h1")).toHaveText("Финансы");
  await expect(dialog.getByRole("radio", { name: "Финансы", exact: true })).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath("new-goal-dialog.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/domains\/finance$/);
  await expect(open).toBeFocused();
  await open.click();
  const title = `Диалог новой цели · ${testInfo.project.name}`;
  await dialog.getByLabel("Название", { exact: true }).fill(title);
  await dialog.getByLabel("Цель", { exact: true }).fill("1000");
  await dialog.getByRole("button", { name: "Создать цель", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/goals\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test("exact decimals, field validation and ambiguous network retry with the same key", async ({ page }, testInfo) => {
  await login(page); await page.goto("/goals/new");
  await page.getByRole("button", { name: "Создать цель", exact: true }).click();
  await expect(page.getByLabel("Название", { exact: true })).toHaveAttribute("aria-invalid", "true");
  // The first invalid field in form order (mockup 10: the sphere comes first) receives focus.
  await expect(page.getByRole("radio", { name: "Языки", exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("radio", { name: "Языки", exact: true })).toBeFocused();
  const path = await create(page, `Точный NOK · ${testInfo.project.name}`, "9007199254740993.01", "9007199254740993.05");
  const id = path.split("/").at(-1)!;
  const keys: string[] = []; let first = true;
  await page.route(`**/api/v1/goals/${id}/measurements`, async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    keys.push(route.request().headers()["idempotency-key"]);
    if (first) { first = false; await route.fetch(); await route.abort("failed"); }
    else await route.continue();
  });
  await add(page, "9007199254740993.02");
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Сервер мог сохранить изменения");
  await expect(page.getByRole("dialog").getByLabel("Значение (NOK)", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Повторить сохранение", exact: true }).click();
  await expect(page.getByTestId("goal-percent")).toHaveText("25%");
  await expect(page.getByTestId("measurement-row")).toHaveCount(1);
  await expect(page.getByTestId("goal-values")).toContainText(/993[,.]02 NOK/);
  expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
  await noOverflow(page);
});

test("creation remains locked until navigation finishes", async ({ page }, testInfo) => {
  await login(page); await page.goto("/goals/new");
  await page.getByLabel("Название", { exact: true }).fill(`Переход без дубля · ${testInfo.project.name}`);
  await page.getByRole("radio", { name: "Финансы", exact: true }).check();
  await page.getByLabel("Цель", { exact: true }).fill("50000");
  const intercepted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route((url) => /\/goals\/[a-f0-9-]{36}$/.test(url.pathname), async (route) => {
    const response = await route.fetch(); intercepted.resolve(); await release.promise; await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Создать цель", exact: true }).click();
  try {
    await intercepted.promise;
    await expect(page.getByRole("button", { name: "Открываем цель…", exact: true })).toBeDisabled();
    await expect(page.getByLabel("Название", { exact: true })).toBeDisabled();
  } finally { release.resolve(); }
  await expect(page.getByText("Недостаточно данных", { exact: true })).toBeVisible();
});

test("keyboard modal traps Tab and restores focus after Escape", async ({ page }, testInfo) => {
  await login(page);
  await create(page, `Клавиатура · ${testInfo.project.name}`);
  const open = page.getByRole("button", { name: "Добавить измерение", exact: true });
  await open.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Закрыть", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Добавить измерение", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Закрыть", exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("keyboard-dialog.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0); await expect(open).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("keyboard-page.png"), fullPage: true });
  await noOverflow(page);
});
