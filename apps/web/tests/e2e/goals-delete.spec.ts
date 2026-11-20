import { test, expect } from "@playwright/test";
import { dashboardResponseSchema } from "@lifeos/contracts";
import { add, create, goalAction, login, noOverflow } from "./support.ts";

for (const archived of [false, true]) {
  test(`LFS-216 delete ${archived ? "archived" : "active"} goal: cancel, focus, retry, filters and counts`, async ({ page }, testInfo) => {
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await login(page);
    const title = `Удаление ${archived ? "архивной" : "активной"} · ${testInfo.project.name}`;
    const path = await create(page, title);
    await add(page, "100");
    await expect(page.getByTestId("measurement-row")).toHaveCount(1);
    if (archived) {
      await goalAction(page, "В архив");
      await page.getByRole("button", { name: "Подтвердить архивирование" }).click();
      await expect(page.getByRole("region", { name: title }).getByText("В архиве", { exact: true })).toBeVisible();
    }
    // Visit Dashboard before deletion, then use client navigation back to test refreshed data after returning.
    await page.goto("/dashboard");
    const before = dashboardResponseSchema.parse(await (await page.request.get("/api/v1/dashboard")).json()).data!;
    const finance = before.domains.find((domain) => domain.key === "finance")!;
    const filters = `?domain_key=finance&status=${archived ? "archived" : "all"}`;
    await page.goto(`/goals${filters}`);
    const tabs = page.getByRole("navigation", { name: "Статус целей" });
    await expect(tabs.getByRole("link", { name: /^Активные/ })).toHaveText(`Активные${finance.activeCount}`);
    await page.getByRole("region", { name: "Список целей" }).getByRole("link", { name: title, exact: true }).click();
    await expect(page).toHaveURL(`${path}${filters}`);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByTestId("measurement-row")).toHaveCount(1);
    const toggle = page.getByRole("button", { name: "Действия с целью", exact: true });
    const dialog = page.getByRole("alertdialog", { name: "Удалить цель?", exact: true });
    await goalAction(page, "Удалить цель");
    await expect(dialog).toContainText("Измерения и история тоже удалятся. Это нельзя отменить.");
    await expect(dialog.getByRole("button", { name: "Отмена", exact: true })).toBeFocused();
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("delete-goal-dialog.png") });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0); await expect(toggle).toBeFocused();
    await expect(page.getByTestId("measurement-row")).toHaveCount(1);
    await goalAction(page, "Удалить цель");
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(dialog).toHaveCount(0); await expect(toggle).toBeFocused();

    const keys: string[] = []; let first = true;
    await page.route(`**/api/v1${path}`, async (route) => {
      if (route.request().method() !== "DELETE") { await route.continue(); return; }
      keys.push(route.request().headers()["idempotency-key"]);
      if (first) { first = false; await route.fetch(); await route.abort("failed"); }
      else await route.continue();
    });
    await goalAction(page, "Удалить цель");
    await dialog.getByRole("button", { name: "Удалить", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Сервер мог сохранить изменения");
    await expect(dialog.getByRole("button", { name: "Отмена", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Повторить запрос", exact: true }).click();
    await expect(page).toHaveURL(`/goals${filters}`);
    await expect(page.getByRole("status").filter({ hasText: "Цель удалена" })).toBeVisible();
    await expect(page.getByRole("link", { name: title, exact: true })).toHaveCount(0);
    await expect(tabs.getByRole("link", { name: /^Активные/ })).toHaveText(`Активные${finance.activeCount - (archived ? 0 : 1)}`);
    await expect(tabs.getByRole("link", { name: /^В архиве/ })).toHaveText(`В архиве${finance.archivedCount - (archived ? 1 : 0)}`);
    expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("deleted-goal-list.png"), fullPage: true });
    if (testInfo.project.name === "mobile") await page.getByRole("button", { name: "Меню", exact: true }).click();
    await page.getByRole("link", { name: "Кабинет", exact: true }).filter({ visible: true }).click();
    const active = before.domains.reduce((sum, domain) => sum + domain.activeCount, 0) - (archived ? 0 : 1);
    const archiveCount = before.domains.reduce((sum, domain) => sum + domain.archivedCount, 0) - (archived ? 1 : 0);
    if (active === 0 && archiveCount === 0) {
      await expect(page.getByText("Целей пока нет. Выберите сферу ниже", { exact: false })).toBeVisible();
      await expect(page.getByTestId("dashboard-summary")).toHaveCount(0);
    } else {
      await expect(page.getByTestId("dashboard-summary")).toContainText(new RegExp(`^${active} активн`));
      if (archiveCount) await expect(page.getByTestId("dashboard-summary")).toContainText(`${archiveCount} в архиве`);
    }
    await expect(page.getByTestId("dashboard-activity").filter({ hasText: title })).toHaveCount(0);
    await expect(page.getByRole("link", { name: `Финансы: ${title}`, exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
