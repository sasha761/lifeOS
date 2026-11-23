import { test, expect } from "@playwright/test";
import { add, create, login, noOverflow } from "./support.ts";

// LFS-224, mockups 32 and 44: the whole row opens the goal; «Удалить» on the row asks the same question as the panel.
test("LFS-224 goal row: click anywhere, keyboard, «Удалить» with cancel and confirm, focus after deletion", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const desktop = testInfo.project.name === "desktop";
  await login(page);
  const older = `Строка старая · ${testInfo.project.name}`;
  const title = `Строка · ${testInfo.project.name}`;
  await create(page, older, "0", "10", { domain: "Навыки" });
  const path = await create(page, title, "0", "10", { domain: "Навыки" });
  await add(page, "4");
  await expect(page.getByTestId("goal-percent")).toHaveText("40%");

  const filters = "?domain_key=skills";
  await page.goto(`/goals${filters}`);
  const list = page.getByRole("region", { name: "Список целей" });
  const rowOf = (name: string) => list.getByTestId("goal-row").filter({ has: page.getByRole("link", { name, exact: true }) });
  const row = rowOf(title);
  const link = row.getByRole("link", { name: title, exact: true });
  const remove = row.getByRole("button", { name: `Удалить цель «${title}»`, exact: true });
  await expect(row.getByTestId("goal-row-progress")).toContainText("40%");
  await expect(rowOf(older).getByTestId("goal-row-progress")).toContainText("Нет данных");
  await expect(list.getByRole("link", { name: /Первое измерение/ })).toHaveCount(0);

  // «Удалить» shows on hover and focus with a mouse on a wide screen; on a phone it is always there, 40px.
  const otherRemove = rowOf(older).getByRole("button", { name: `Удалить цель «${older}»`, exact: true });
  if (desktop) {
    await page.mouse.move(1, 1);
    await expect(otherRemove).toHaveCSS("opacity", "0");
    await rowOf(older).hover();
    await expect(otherRemove).toHaveCSS("opacity", "1");
  } else {
    await expect(otherRemove).toHaveCSS("opacity", "1");
    const box = (await otherRemove.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(40); expect(box.height).toBeGreaterThanOrEqual(40);
  }
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("goal-rows.png"), fullPage: true });

  // A click on an empty part of the card (its top padding, left of «Удалить») opens the goal.
  const card = (await row.boundingBox())!;
  await row.click({ position: { x: card.width - 70, y: 6 } });
  await expect(page).toHaveURL(`${path}${filters}`);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  // On a phone the open goal is its own screen and the list is hidden.
  if (desktop) await expect(link).toHaveAttribute("aria-current", "true");

  // Keyboard: Tab goes from the link to «Удалить», Enter on the link opens the goal, on the button the dialog.
  await page.goto(`/goals${filters}`);
  await link.focus();
  await page.keyboard.press("Tab");
  await expect(remove).toBeFocused();
  await expect(remove).toHaveCSS("opacity", "1");
  const dialog = page.getByRole("alertdialog", { name: "Удалить цель?", exact: true });
  await page.keyboard.press("Enter");
  await expect(dialog).toContainText("Измерения и история тоже удалятся. Это нельзя отменить.");
  await expect(dialog.getByRole("button", { name: "Отмена", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0); await expect(remove).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${path}${filters}`);

  // «Отмена» keeps the goal; «Удалить» removes it, the list is read again and focus goes to the next row.
  await page.goto(`/goals${filters}`);
  await remove.click();
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(remove).toBeFocused();
  await expect(link).toBeVisible();
  const neighbour = await row.evaluate((element) => {
    const item = element.closest("li");
    return (item?.nextElementSibling ?? item?.previousElementSibling)?.querySelector("[data-goal-link]")?.getAttribute("data-goal-link") ?? null;
  });
  expect(neighbour).not.toBeNull();
  await remove.click();
  await dialog.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Цель удалена" })).toBeVisible();
  await expect(page).toHaveURL(`/goals${filters}`);
  await expect(list.getByRole("link", { name: title, exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-goal-link") ?? null)).toBe(neighbour);
  expect((await page.request.get(`/api/v1${path}`)).status()).toBe(404);
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("goal-row-deleted.png"), fullPage: true });
  expect(errors).toEqual([]);
});
