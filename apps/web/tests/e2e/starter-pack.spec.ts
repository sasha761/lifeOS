import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { goalAction, login, noOverflow } from "./support.ts";

/** The example lives in its own fixture account per project, so 1280 and 390 never meet the same set (LFS-218). */
test("the example: labels and banner, an edit makes a goal the person's own, «Удалить все примеры» keeps it (LFS-218)", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await login(page, testInfo.project.name === "mobile" ? "EXAMPLE_MOBILE" : "EXAMPLE_DESKTOP");
  // Loaded through the API, as the popup does; the popup itself is covered by start-dialog.spec.ts (LFS-220).
  const loaded = await page.request.post("/api/v1/starter-pack", { headers: { "idempotency-key": randomUUID() } });
  expect(loaded.status()).toBe(200);

  await page.goto("/dashboard");
  const banner = page.getByTestId("examples-banner");
  await expect(banner.getByRole("heading", { name: "Это пример", exact: true })).toBeVisible();
  await expect(banner).toContainText(/7 целей и 7 измерений помечены «Пример»/);
  await expect(page.getByTestId("dashboard-summary")).toContainText("Все цели и измерения пока примерные.");
  await expect(page.getByTestId("dashboard-activity").first()).toContainText("Пример");
  await expect(page.getByTestId("dashboard-activity").first()).toContainText("стартовый набор");
  await expect(page.getByTestId("dashboard-domain-finance").getByText("Пример", { exact: true }).filter({ visible: true })).toHaveCount(1);
  await expect(page.getByText("помечает цели и измерения из стартового набора")).toBeVisible();
  await noOverflow(page);

  // The person corrects the start of an example: the example value goes, the label goes, the goal stays.
  const goals = await (await page.request.get("/api/v1/goals?domain_key=finance")).json() as { data: { items: { goal: { id: string; title: string } }[] } };
  const savings = goals.data.items.find(({ goal }) => goal.title === "Накопить 5 000 $")!.goal;
  await page.goto(`/goals/${savings.id}`);
  const panel = page.getByRole("region", { name: savings.title });
  await expect(panel.getByTestId("example-hint")).toHaveText("Это пример: поправьте старт и цель под себя или удалите цель.");
  const row = panel.getByTestId("measurement-row");
  await expect(row).toHaveCount(1);
  await expect(row.getByText("Пример", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Изменить", exact: true })).toHaveCount(0);
  await goalAction(page, "Изменить цель");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("примерное измерение удалится");
  await dialog.getByLabel("Старт", { exact: true }).fill("500");
  await dialog.getByRole("button", { name: "Сохранить изменения цели" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(panel.getByTestId("example-hint")).toHaveCount(0);
  await expect(panel.getByTestId("measurement-row")).toHaveCount(0);
  await expect(page.getByTestId("goal-history")).toContainText(/Старт изменён: 0 → 500, метка «Пример» снята/);
  await noOverflow(page);

  // «Удалить все примеры»: confirmation under the banner, Escape returns focus, then the six examples go.
  await page.goto("/dashboard");
  await expect(banner).toContainText(/6 целей и 6 измерений помечены «Пример»/);
  const removeAll = banner.getByRole("button", { name: "Удалить все примеры", exact: true });
  await removeAll.click();
  const confirm = page.getByRole("alertdialog", { name: "Удалить все примеры?" });
  await expect(confirm).toContainText("Удалим 6 примерных целей вместе с их измерениями и историей.");
  await expect(confirm.getByRole("button", { name: "Отмена", exact: true })).toBeFocused();
  await noOverflow(page);
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(removeAll).toBeFocused();
  await removeAll.click();
  await confirm.getByRole("button", { name: "Удалить 6 целей", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Примеры удалены: 6 целей." })).toBeFocused();
  await expect(banner).toHaveCount(0);
  await expect(page.getByText("помечает цели и измерения из стартового набора")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-summary")).toContainText("1 активная цель в 1 сфере.");
  await expect(page.getByTestId("dashboard-domain-finance").getByRole("link", { name: `Финансы: ${savings.title}`, exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
