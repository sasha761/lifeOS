import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { goalDetailsSchema } from "@lifeos/contracts";
import type { ActivityEntry } from "@lifeos/contracts";
import { PhaseState } from "../components/goals/goal-detail.tsx";
import { GoalRow } from "../components/goals/goals-browser.tsx";
import { describeActivity } from "../lib/activity-presentation.ts";
import { activityLabel } from "../lib/dashboard-presentation.ts";
import { goalFormInput } from "../lib/goal-form-input.ts";
import { phaseLabel } from "../lib/goal-presentation.ts";
import { startOfLocalDay } from "../lib/goal-time.ts";

// LFS-225: goals without measurements, phases and the start date in the web UI (mockups 32, 36).
const preferences = { timezone: "Europe/Oslo", locale: "ru" };
const time = "2026-11-15T10:00:00.000Z";
const id = "4fe63a56-7a7f-4905-bdc3-c9dff1d439dc";
const stored = { id, user_id: "owner", status: "active", origin: "manual", created_at: time, updated_at: time, phase_changed_at: "2026-11-15T09:00:00.000Z" };
const unmeasuredProgress = { methodology: null, source: "manual", provenance: null, unit: null, baseline: null, target: null, current: null,
  status: "unmeasured", progressPercent: null, updatedAt: time, measurementCount: 0 };
const work = (phase: string, extra: Record<string, unknown> = {}) => goalDetailsSchema.parse({
  goal: { ...stored, kind: "unmeasured", domain_key: "work", title: "Найти новую работу", phase, ...extra },
  progress: { ...unmeasuredProgress, explanation: { planned: "Запланирована", in_progress: "В процессе", paused: "На паузе", achieved: "Достигнута" }[phase] } });
const savings = (phase: string) => goalDetailsSchema.parse({
  goal: { ...stored, domain_key: "finance", title: "Подушка", unit: "NOK", baseline: "0", target: "10000", direction: "increase", phase },
  progress: { methodology: { version: 1, mode: "manual", formula: "(current-baseline)/(target-baseline)", percentDecimals: 2, rounding: "half_up", clamped: true },
    source: "manual", provenance: null, unit: "NOK", baseline: "0", target: "10000", current: null, status: "insufficient_data", progressPercent: null,
    explanation: "Недостаточно данных", updatedAt: time, measurementCount: 0 } });
const row = (value: ReturnType<typeof work>, label = "Работа") =>
  renderToStaticMarkup(createElement(GoalRow, { value, label, preferences, href: `/goals/${id}`, selected: false, onDelete() {} }));
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/[  ]/g, " ");

describe("goal rows with phases (mockup 32)", () => {
  it("shows a goal without measurements with its status chip instead of a bar, and «с <начало> · до <срок>»", () => {
    const html = row(work("in_progress", { starts_at: "2026-10-31T23:00:00.000Z", due_at: "2027-03-31T21:59:59.999Z" }));
    expect(html).not.toContain("<progress"); expect(html).not.toContain("Нет данных");
    expect(text(html)).toContain("Работа · с 01.11.2026 · до 31.03.2027");
    expect(html).toMatch(/data-tone="amber"[^>]*>В процессе</);
    expect(html.match(/<(a|button)\b/g)).toEqual(["<a", "<button"]);
  });
  it("says when an achieved goal was marked and shows the planned and paused chips", () => {
    expect(text(row(work("achieved", { due_at: "2027-03-31T21:59:59.999Z" })))).toContain("Работа · отмечена 15.11.2026");
    expect(row(work("achieved"))).toMatch(/data-tone="green"[^>]*>✓ Достигнута</);
    expect(row(work("planned"))).toMatch(/data-tone="neutral"[^>]*>Запланирована</);
  });
  it("puts the status of a numeric goal by its title unless it is in progress", () => {
    expect(row(savings("in_progress"), "Финансы")).not.toMatch(/В процессе|Запланирована|На паузе/);
    expect(row(savings("paused"), "Финансы")).toMatch(/data-tone="blue"[^>]*>На паузе</);
    expect(row(savings("achieved"), "Финансы")).toContain("✓ Достигнута");
    expect(row(savings("paused"), "Финансы")).toContain("Нет данных");
  });
});

describe("panel of a goal without measurements (mockup 36, «Достигнута» by the owner)", () => {
  const now = new Date("2026-11-22T12:00:00Z");
  const render = (phase: string, extra: Record<string, unknown> = {}) =>
    text(renderToStaticMarkup(createElement(PhaseState, { goal: work(phase, extra).goal, preferences, now })));
  it("shows «В процессе» with the start and the days to the deadline, and why there is no percentage", () => {
    const html = render("in_progress", { starts_at: "2026-10-31T23:00:00.000Z", due_at: "2027-03-31T21:59:59.999Z" });
    expect(html).toContain("В процессе"); expect(html).toContain("с 01.11.2026 · 129 дней до срока");
    expect(html).toContain("Процента нет. Когда цель будет достигнута, отметьте её сами.");
  });
  it("shows «✓ Достигнута», when it was marked, the manual source and how to undo it", () => {
    const html = render("achieved");
    expect(html).toContain("✓ Достигнута"); expect(html).toContain("отмечена 15.11.2026"); expect(html).toContain("ручная отметка");
    expect(html).toContain("Цель снова станет «В процессе», если вернуть её в работу. Отметка останется в истории.");
  });
  it("shows since when a goal is paused", () => {
    expect(render("paused")).toContain("на паузе с 15.11.2026 · срок не задан");
    expect(phaseLabel("planned")).toBe("Запланирована");
  });
});

describe("journal and dates (LFS-225)", () => {
  const base = { id: "5fe63a56-7a7f-4905-bdc3-c9dff1d439dc", type: "goal.updated", occurredAt: time, source: "web", domainKey: "work",
    goal: { id, title: "Найти работу", status: "active" }, measurement: null, startsAt: null, dueAt: null, definition: null, phase: null, example: false } as const;
  it("names a phase change on the Dashboard by the new phase", () => {
    expect(activityLabel("goal.updated", { before: "in_progress", after: "achieved" })).toBe("Статус: Достигнута");
    expect(activityLabel("goal.updated")).toBe("Изменена цель");
  });
  it("describes a phase change and a start date edit", () => {
    expect(describeActivity({ ...base, changedFields: ["phase"], phase: { before: "in_progress", after: "achieved" } } as ActivityEntry, preferences))
      .toBe("Статус изменён: В процессе → Достигнута");
    expect(describeActivity({ ...base, changedFields: ["starts_at"], startsAt: { before: null, after: "2026-10-31T23:00:00.000Z" } } as ActivityEntry, preferences, { withTitle: true }))
      .toBe("Цель «Найти работу»: дата начала изменена: без даты → 01.11.2026");
  });
  it("stores a start date as the beginning of that day in the account's zone, or the first hour when midnight is skipped", () => {
    expect(startOfLocalDay("2026-12-01", "Europe/Oslo")).toBe("2026-11-30T23:00:00.000Z");
    expect(startOfLocalDay("2026-07-01", "Europe/Oslo")).toBe("2026-06-30T22:00:00.000Z");
    expect(startOfLocalDay("2026-09-06", "America/Santiago")).toBe("2026-09-06T04:00:00.000Z");
  });
  it("sends the start of an edit and rejects a start after the deadline", () => {
    const form = (values: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };
    expect(goalFormInput(form({ title: "Работа", starts_at: "2026-11-01", due_at: "2027-03-31" }), "Europe/Oslo", true).data)
      .toMatchObject({ starts_at: "2026-10-31T23:00:00.000Z", due_at: "2027-03-31T21:59:59.999Z" });
    expect(goalFormInput(form({ title: "Работа", starts_at: "", due_at: "" }), "Europe/Oslo", true).data).toMatchObject({ starts_at: null, due_at: null });
    expect(goalFormInput(form({ title: "Работа", starts_at: "2027-04-01", due_at: "2027-03-31" }), "Europe/Oslo", true).errors)
      .toEqual({ starts_at: "Дата начала не может быть позже срока." });
    // «Новая цель» has no start field yet (LFS-228): the start is not sent.
    expect(goalFormInput(form({ title: "Подушка", domain_key: "finance", unit: "NOK", baseline: "0", target: "10", direction: "increase" }), "Europe/Oslo").data)
      .toMatchObject({ kind: "numeric", starts_at: null });
  });
});
