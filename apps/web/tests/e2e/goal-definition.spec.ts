import { test, expect } from "@playwright/test";
import { add, create, goalAction, login, noOverflow, openHistory } from "./support.ts";

test("start and target change until the first measurement; the deadline is optional (LFS-217)", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  await create(page, `Поправить старт · ${testInfo.project.name}`, "0", "5000");
  await goalAction(page, "Изменить цель");
  const dialog = page.getByRole("dialog");
  const deadline = dialog.getByLabel("Срок · необязательно", { exact: true });
  const removeDeadline = dialog.getByRole("button", { name: "Убрать срок", exact: true });
  await expect(deadline).toHaveValue("");
  await expect(removeDeadline).toHaveCount(0);
  await dialog.getByLabel("Старт", { exact: true }).fill("1000");
  await dialog.getByLabel("Цель", { exact: true }).fill("6000");
  await deadline.fill("2027-03-01");
  await expect(removeDeadline).toBeVisible();
  await noOverflow(page);
  await dialog.getByRole("button", { name: "Сохранить изменения цели" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Grouping and date separators depend on the fixture locale, so any separator is accepted.
  const history = await openHistory(page);
  await expect(history).toContainText(/Старт изменён: 0 → 1.000, цель изменена: 5.000 → 6.000, срок изменён: без срока → 01[./]03[./]2027/);
  // A saved deadline is removed with «Убрать срок»: the field empties and keeps focus, the goal is saved without a deadline.
  await goalAction(page, "Изменить цель");
  await expect(deadline).toHaveValue("2027-03-01");
  await removeDeadline.click();
  await expect(deadline).toHaveValue("");
  await expect(deadline).toBeFocused();
  await expect(removeDeadline).toHaveCount(0);
  await dialog.getByRole("button", { name: "Сохранить изменения цели" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(history).toContainText(/Срок изменён: 01[./]03[./]2027 → без срока/);
  await add(page, "2000");
  await expect(page.getByTestId("goal-percent")).toHaveText("20%");
  await goalAction(page, "Изменить цель");
  await expect(dialog.getByLabel("Старт", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Единица", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Старт и цель фиксируются после первого измерения", { exact: false })).toBeVisible();
  await expect(dialog.getByLabel("Срок · необязательно", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});
