import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { apiWrite, root, startUiFixture } from "./ui-fixture.ts";
import type { UiFixture } from "./ui-fixture.ts";

/*
 * `pnpm ui:shots` (LFS-212, docs/UI_GUIDELINES.md §5): screenshots of Stage 2 pages next to their mockups.
 * Runs on the isolated fixture (test PostgreSQL schema, production build) with goals created through the API.
 * Output in .cache/ui-shots: <page>-1440.png, <page>-390.png, <page>-compare.png (mockup | 1440 | 390), report.json.
 * The fixture data are test records for the screenshots, not data from the mockups.
 */
const out = join(root, ".cache/ui-shots");
const mockups = join(root, "docs/reference/ui");
const day = 86_400_000;
const viewports = [{ width: 1440, height: 900, mobile: false }, { width: 390, height: 844, mobile: true }] as const;
let stage = "isolated test setup";

type Shot = { name: string; path: string; mockup: string; open?: (page: Page) => Promise<void>; account?: "owner" | "example" };
type Problem = { page: string; width: number; problem: string };

async function seed(fixture: UiFixture) {
  const { base, cookies } = fixture;
  const create = (body: Record<string, unknown>) => apiWrite<{ goal: { id: string } }>(base, cookies.owner, "/api/v1/goals", body);
  const measure = (id: string, value: string, daysAgo: number) =>
    apiWrite(base, cookies.owner, `/api/v1/goals/${id}/measurements`, { value, measured_at: new Date(Date.now() - daysAgo * day).toISOString(), source: "manual" });
  const due = (days: number) => new Date(Date.now() + days * day).toISOString();
  const savings = await create({ domain_key: "finance", title: "Резерв на полгода расходов", unit: "NOK", baseline: "0", target: "60000", direction: "increase", due_at: due(120) });
  await measure(savings.goal.id, "9000", 30); await measure(savings.goal.id, "18000", 2);
  const words = await create({ domain_key: "languages", title: "Норвежский: 400 новых слов", unit: "count", baseline: "0", target: "400", direction: "increase", due_at: due(25) });
  await measure(words.goal.id, "160", 1);
  const weight = await create({ domain_key: "health", title: "Вес до 78 кг", unit: "custom", unit_label: "кг", baseline: "86", target: "78", direction: "decrease", due_at: due(-2) });
  await measure(weight.goal.id, "83", 3);
  const practice = await create({ domain_key: "skills", title: "Практика TypeScript", unit: "minutes", baseline: "0", target: "1800", direction: "increase" });
  await measure(practice.goal.id, "540", 4);
  const applications = await create({ domain_key: "work", title: "Отклики на вакансии", unit: "count", baseline: "0", target: "15", direction: "increase", due_at: due(5) });
  const archived = await create({ domain_key: "projects", title: "Черновик сайта портфолио", unit: "count", baseline: "0", target: "5", direction: "increase" });
  await apiWrite(base, cookies.owner, `/api/v1/goals/${archived.goal.id}`, { status: "archived" }, "PATCH");
  return { goalId: savings.goal.id, archivedId: archived.goal.id, unmeasuredId: applications.goal.id };
}

/** Waits until client data have loaded: no skeleton or «Загружаем…» status, fonts ready. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => ![...document.querySelectorAll("[role=status]")].some((element) => /Загружаем/.test(element.textContent ?? "")));
  await page.evaluate(() => document.fonts.ready);
}

async function capture(context: BrowserContext, base: string, shot: Shot, width: number, problems: Problem[], cookie: string) {
  // Each shot signs in as its own fixture account (the example lives in a separate one, LFS-218).
  const separator = cookie.indexOf("=");
  await context.clearCookies();
  await context.addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: base }]);
  const page = await context.newPage();
  page.on("pageerror", (error) => problems.push({ page: shot.name, width, problem: `page error: ${error.message}` }));
  page.on("request", (request) => { if (new URL(request.url()).hostname !== "127.0.0.1") problems.push({ page: shot.name, width, problem: `external request: ${request.url()}` }); });
  await page.goto(base + shot.path, { waitUntil: "networkidle" });
  await settle(page);
  if (shot.open) { await shot.open(page); await settle(page); }
  if (!(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))) problems.push({ page: shot.name, width, problem: "horizontal overflow" });
  const file = join(out, `${shot.name}-${width}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await page.close();
  return file;
}

/** Mockup on the left, then the implementation at 1440 and 390 px; images are inlined, so no file access is needed. */
async function compare(browser: Browser, shot: Shot, desktop: string, mobile: string) {
  const image = async (path: string) => `data:image/png;base64,${(await readFile(path)).toString("base64")}`;
  const [mockup, wide, narrow] = await Promise.all([image(join(mockups, shot.mockup)), image(desktop), image(mobile)]);
  const page = await browser.newPage({ viewport: { width: 3400, height: 900 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:24px;background:Canvas;color:CanvasText;font:600 20px system-ui,sans-serif;color-scheme:dark}
    .row{display:flex;gap:32px;align-items:flex-start}figure{margin:0}figcaption{margin-bottom:12px}
    img{display:block;outline:1px solid GrayText}</style>
    <div class="row">
      <figure><figcaption>Макет · ${shot.mockup}</figcaption><img src="${mockup}" width="1440"></figure>
      <figure><figcaption>Реализация · ${shot.path} · 1440</figcaption><img src="${wide}" width="1440"></figure>
      <figure><figcaption>390</figcaption><img src="${narrow}" width="390"></figure>
    </div>`);
  await page.waitForFunction(() => [...document.images].every((element) => element.complete && element.naturalWidth > 0));
  await page.screenshot({ path: join(out, `${shot.name}-compare.png`), fullPage: true });
  await page.close();
}

async function main() {
  let fixture: UiFixture | undefined;
  let browser: Browser | undefined;
  try {
    // Russian number and date formats, as on the mockups.
    fixture = await startUiFixture({ suite: "lfs212_shots", ownerLocale: "ru", onStage: (value) => { stage = value; } });
    stage = "test data through the API";
    const { goalId, archivedId, unmeasuredId } = await seed(fixture);
    stage = "example through the API";
    const example = await fetch(`${fixture.base}/api/v1/starter-pack`, { method: "POST", headers: { cookie: fixture.cookies.exampleDesktop, "idempotency-key": randomUUID() } });
    assert(example.ok, `POST /api/v1/starter-pack → ${example.status}`);
    const shots: Shot[] = [
      { name: "home", path: "/", mockup: "04-progress.png" },
      { name: "dashboard", path: "/dashboard", mockup: "04-progress.png" },
      { name: "goals", path: "/goals", mockup: "09-goals.png" },
      { name: "goal", path: `/goals/${goalId}`, mockup: "09-goals.png" },
      { name: "goal-menu", path: `/goals/${goalId}`, mockup: "09-goals.png", open: async (page) => {
        await page.getByRole("button", { name: "Действия с целью", exact: true }).click();
      } },
      ...[{ name: "goal-delete", id: goalId }, { name: "goal-delete-archived", id: archivedId }].map(({ name, id }): Shot => ({
        name, path: `/goals/${id}`, mockup: "09-goals.png", open: async (page) => {
          await page.getByRole("button", { name: "Действия с целью", exact: true }).click();
          await page.getByRole("button", { name: "Удалить цель", exact: true }).click();
        },
      })),
      // LFS-217: editing an unmeasured goal shows the definition fields of the «Новая цель» dialog; a measured one only the hint.
      ...[{ name: "goal-edit", id: unmeasuredId }, { name: "goal-edit-measured", id: goalId }].map(({ name, id }): Shot => ({
        name, path: `/goals/${id}`, mockup: "10-domain-new-goal.png", open: async (page) => {
          await page.getByRole("button", { name: "Действия с целью", exact: true }).click();
          await page.getByRole("button", { name: "Изменить цель", exact: true }).click();
          await page.getByRole("dialog", { name: "Изменить цель" }).waitFor();
        },
      })),
      { name: "domain-finance", path: "/domains/finance", mockup: "10-domain-new-goal.png" },
      // As on the mockup: the «Новая цель» dialog opened from the sphere page.
      { name: "goal-new", path: "/domains/finance", mockup: "10-domain-new-goal.png", open: async (page) => {
        await page.getByRole("link", { name: "Цель в сфере", exact: true }).click();
        await page.getByRole("dialog", { name: "Новая цель" }).waitFor();
      } },
      { name: "settings", path: "/settings", mockup: "16-settings.png" },
      // LFS-218: an account with the loaded example, as on mockup 28; then the «Удалить все примеры?» card.
      { name: "dashboard-example", path: "/dashboard", mockup: "28-onb-example.png", account: "example" },
      { name: "dashboard-example-confirm", path: "/dashboard", mockup: "28-onb-example.png", account: "example", open: async (page) => {
        await page.getByRole("button", { name: "Удалить все примеры", exact: true }).click();
        await page.getByRole("alertdialog", { name: "Удалить все примеры?" }).waitFor();
      } },
    ];
    stage = "browser screenshots";
    await mkdir(out, { recursive: true });
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === "win32" ? "msedge" : undefined) });
    const problems: Problem[] = [];
    const files: Record<string, Record<number, string>> = {};
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1, isMobile: viewport.mobile, hasTouch: viewport.mobile });
      for (const shot of shots) {
        const cookie = shot.account === "example" ? fixture.cookies.exampleDesktop : fixture.cookies.owner;
        (files[shot.name] ??= {})[viewport.width] = await capture(context, fixture.base, shot, viewport.width, problems, cookie);
      }
      await context.close();
    }
    stage = "side-by-side comparison";
    for (const shot of shots) await compare(browser, shot, files[shot.name]![1440]!, files[shot.name]![390]!);
    await writeFile(join(out, "report.json"), JSON.stringify({ pages: shots.map(({ name, path, mockup }) => ({ name, path, mockup })), problems }, null, 2));
    console.log(`UI shots: ${shots.length} pages × ${viewports.length} widths + comparisons in .cache/ui-shots.`);
    if (problems.length) { console.error(`Problems: ${problems.map((item) => `${item.page}@${item.width}: ${item.problem}`).join("; ")}`); process.exitCode = 1; }
  } finally {
    await browser?.close();
    await fixture?.stop();
  }
}
main().catch(() => { console.error(`UI shots failed during ${stage}.`); process.exitCode = 1; });
