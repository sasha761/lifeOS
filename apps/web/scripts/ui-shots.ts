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

type Shot = { name: string; path: string; mockup: string; open?: (page: Page) => Promise<void>; account?: "owner" | "example" | "onboarding" | "start" | "setup"; prepare?: () => Promise<void> };
type Problem = { page: string; width: number; problem: string };

async function seed(fixture: UiFixture) {
  const { base, cookies } = fixture;
  const create = (body: Record<string, unknown>) => apiWrite<{ goal: { id: string } }>(base, cookies.owner, "/api/v1/goals", body);
  const measure = (id: string, value: string, daysAgo: number) =>
    apiWrite(base, cookies.owner, `/api/v1/goals/${id}/measurements`, { value, measured_at: new Date(Date.now() - daysAgo * day).toISOString(), source: "manual" });
  const due = (days: number) => new Date(Date.now() + days * day).toISOString();
  const debt = await create({ domain_key: "finance", title: "Погасить кредит", unit: "USD", baseline: "2400", target: "0", direction: "decrease", measurement_mode: "contributions", due_at: due(170) });
  await measure(debt.goal.id, "475.5", 7); await measure(debt.goal.id, "630", 22);
  const savings = await create({ measurement_mode: "contributions", domain_key: "finance", title: "Резерв на полгода расходов", unit: "NOK", baseline: "0", target: "60000", direction: "increase", due_at: due(120) });
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
  // LFS-225: goals without measurements (through the API until LFS-227/228) and phases of numeric goals.
  const phase = (id: string, value: string) => apiWrite(base, cookies.owner, `/api/v1/goals/${id}`, { phase: value }, "PATCH");
  await phase(weight.goal.id, "paused");
  const course = await create({ kind: "unmeasured", domain_key: "skills", title: "Пройти курс по SQL" });
  await phase(course.goal.id, "achieved");
  const job = await create({ kind: "unmeasured", domain_key: "work", title: "Сменить работу", description: "Тестовое описание цели без измерений.",
    starts_at: new Date(Date.now() - 20 * day).toISOString(), due_at: due(130) });
  return { goalId: savings.goal.id, debtId: debt.goal.id, weightId: weight.goal.id, archivedId: archived.goal.id, unmeasuredId: applications.goal.id, jobId: job.goal.id, courseId: course.goal.id };
}

/**
 * Draft of the onboarding wizard (LFS-219) for its screenshots: four spheres, one of them skipped, a template answer, a
 * language, two Health choices with «Свой вариант». Test values of the fixture, not the numbers of the mockups.
 */
function onboardingDraft(step: string) {
  const due = (days: number) => new Date(Date.now() + days * day).toISOString();
  const choice = (option: string, values: Record<string, unknown>) => ({ option, subject: "", direction: "increase", unit: "custom", unit_label: "", baseline: "", target: "", due_at: null, ...values });
  return { answers: { step, domains: ["languages", "finance", "skills", "health"], extra: [], unchecked: [], spheres: {
    languages: { skipped: false, choices: [choice("german", { baseline: "1", target: "3", due_at: due(240) })] },
    finance: { skipped: false, choices: [choice("emergency_fund", { unit: "NOK", target: "60000", baseline: "15000", due_at: due(200) })] },
    skills: { skipped: true, choices: [] },
    health: { skipped: false, choices: [choice("training", { baseline: "1", target: "4" }),
      choice("own", { subject: "Проплыть 2 км без остановки", unit_label: "метров за заплыв", baseline: "600", target: "2000", due_at: due(300) })] },
  } } };
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
    const { goalId, debtId, weightId, archivedId, unmeasuredId, jobId, courseId } = await seed(fixture);
    stage = "example through the API";
    const example = await fetch(`${fixture.base}/api/v1/starter-pack`, { method: "POST", headers: { cookie: fixture.cookies.exampleDesktop, "idempotency-key": randomUUID() } });
    assert(example.ok, `POST /api/v1/starter-pack → ${example.status}`);
    // LFS-220: an account that completed the questions, for «Начальная настройка» in Settings (mockups 30, 31).
    stage = "completed setup through the API";
    await apiWrite(fixture.base, fixture.cookies.startMobile, "/api/v1/onboarding/complete",
      { ...onboardingDraft("summary"), selected: ["languages.german", "finance.emergency_fund", "health.training", "health.own"] });
    const shots: Shot[] = [
      { name: "home", path: "/", mockup: "04-progress.png" },
      { name: "dashboard", path: "/dashboard", mockup: "04-progress.png" },
      // LFS-224: the goals list and the lighter panel of mockup 32 (390 px — mockup 44, the list phone).
      { name: "goals", path: "/goals", mockup: "32-goals-list.png" },
      { name: "goal", path: `/goals/${goalId}`, mockup: "32-goals-list.png" },
      { name: "goal-payment-panel", path: `/goals/${debtId}`, mockup: "32-goals-list.png" },
      ...[
        { name: "goal-payment-dialog", id: debtId, action: "Внести платёж", field: "Сумма платежа, $", amount: "215,78" },
        { name: "goal-deposit-dialog", id: goalId, action: "Пополнить", field: "Сумма пополнения, NOK", amount: "1250" },
        { name: "goal-value-dialog", id: weightId, action: "Новое значение", field: "Вес сейчас, кг", amount: "82,5" },
        { name: "goal-payment-edit", id: debtId, action: "Изменить", field: "Сумма платежа, $", amount: "500" },
      ].map(({ name, id, action, field, amount }): Shot => ({
        name, path: `/goals/${id}`, mockup: "37-measure-dialogs.png", open: async (page) => {
          const trigger = action === "Изменить" ? page.getByTestId("measurement-row").first() : page;
          await trigger.getByRole("button", { name: action, exact: true }).click();
          await page.getByRole("dialog").getByLabel(field, { exact: true }).fill(amount);
        },
      })),
      { name: "goal-menu", path: `/goals/${goalId}`, mockup: "32-goals-list.png", open: async (page) => {
        await page.getByRole("button", { name: "Действия с целью", exact: true }).click();
      } },
      // «Как считается» and «История изменений» opened under the panel.
      { name: "goal-sections", path: `/goals/${goalId}`, mockup: "32-goals-list.png", open: async (page) => {
        await page.getByRole("button", { name: "Как считается" }).click();
        await page.getByRole("button", { name: /^История изменений/ }).click();
      } },
      // LFS-225: a goal without measurements in progress (mockup 36) and achieved (described by the owner, no mockup of its own).
      { name: "goal-no-measure", path: `/goals/${jobId}`, mockup: "36-goals-list-no-measure.png" },
      { name: "goal-achieved", path: `/goals/${courseId}`, mockup: "36-goals-list-no-measure.png" },
      { name: "goal-phase-menu", path: `/goals/${jobId}`, mockup: "36-goals-list-no-measure.png", open: async (page) => {
        await page.getByRole("button", { name: "Действия с целью", exact: true }).click();
      } },
      // «Удалить» on a row: hover shows it (mouse), the confirmation is the panel's one.
      { name: "goals-row-delete", path: "/goals", mockup: "32-goals-list.png", open: async (page) => {
        const row = page.getByTestId("goal-row").nth(1);
        await row.hover();
        await row.getByRole("button", { name: /^Удалить цель/ }).click();
        await page.getByRole("alertdialog", { name: "Удалить цель?" }).waitFor();
      } },
      ...[{ name: "goal-delete", id: goalId }, { name: "goal-delete-archived", id: archivedId }].map(({ name, id }): Shot => ({
        name, path: `/goals/${id}`, mockup: "32-goals-list.png", open: async (page) => {
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
      // LFS-220: the first-visit popup on a fresh account (23; at 390 the bottom sheet of 29), Settings after the questions (30)
      // and the same popup opened there (31).
      { name: "dashboard-start", path: "/dashboard", mockup: "23-onb-start.png", account: "start", open: async (page) => {
        await page.getByRole("dialog", { name: "Добро пожаловать в LifeOS" }).waitFor();
      } },
      { name: "settings-onboarding", path: "/settings", mockup: "30-onb-settings.png", account: "setup" },
      { name: "settings-onboarding-dialog", path: "/settings", mockup: "31-onb-reopen.png", account: "setup", open: async (page) => {
        await page.getByRole("button", { name: "Открыть начальную настройку", exact: true }).click();
        await page.getByRole("dialog", { name: "Что добавить в аккаунт?" }).waitFor();
      } },
      // LFS-218: an account with the loaded example, as on mockup 28; then the «Удалить все примеры?» card.
      { name: "dashboard-example", path: "/dashboard", mockup: "28-onb-example.png", account: "example" },
      { name: "dashboard-example-confirm", path: "/dashboard", mockup: "28-onb-example.png", account: "example", open: async (page) => {
        await page.getByRole("button", { name: "Удалить все примеры", exact: true }).click();
        await page.getByRole("alertdialog", { name: "Удалить все примеры?" }).waitFor();
      } },
      // LFS-219: the wizard on a fresh account; the draft puts it on the step of each mockup.
      ...([["onboarding-spheres", "domains", "24-onb-spheres.png"], ["onboarding-question", "finance", "25-onb-question.png"],
        ["onboarding-own", "health", "26-onb-own-answer.png"], ["onboarding-summary", "summary", "27-onb-summary.png"],
        ["onboarding-languages", "languages", "29-onb-mobile.png"]] as const).map(([name, step, mockup]): Shot => ({
        name, path: "/onboarding", mockup, account: "onboarding",
        prepare: async () => { await apiWrite(fixture!.base, fixture!.cookies.onboardingDesktop, "/api/v1/onboarding", onboardingDraft(step), "PUT"); },
      })),
      // «Изменить» on the summary: the editor of the step in a dialog.
      { name: "onboarding-summary-edit", path: "/onboarding", mockup: "27-onb-summary.png", account: "onboarding",
        prepare: async () => { await apiWrite(fixture!.base, fixture!.cookies.onboardingDesktop, "/api/v1/onboarding", onboardingDraft("summary"), "PUT"); },
        open: async (page) => {
          await page.getByRole("button", { name: "Изменить цель «Подушка безопасности»", exact: true }).click();
          await page.getByRole("dialog", { name: "Изменить цель" }).waitFor();
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
        const cookie = { example: fixture.cookies.exampleDesktop, onboarding: fixture.cookies.onboardingDesktop, start: fixture.cookies.startDesktop,
          setup: fixture.cookies.startMobile, owner: fixture.cookies.owner }[shot.account ?? "owner"];
        await shot.prepare?.();
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
