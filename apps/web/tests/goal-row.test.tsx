import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { goalDetailsSchema } from "@lifeos/contracts";
import { GoalProgressPanel } from "../components/goals/goal-detail.tsx";
import { GoalRow } from "../components/goals/goals-browser.tsx";

const preferences = { timezone: "Europe/Oslo", locale: "ru" };
const methodology = { version: 1, mode: "manual", formula: "(current-baseline)/(target-baseline)", percentDecimals: 2, rounding: "half_up", clamped: true };
const goal = { id: "4fe63a56-7a7f-4905-bdc3-c9dff1d439dc", user_id: "owner", title: "Накопить 50 000 NOK", domain_key: "finance", baseline: "0", target: "50000", unit: "NOK",
  direction: "increase", status: "active", due_at: "2027-06-30T21:59:59.999Z", created_at: "2026-11-16T10:00:00Z", updated_at: "2026-11-16T10:00:00Z" };
const empty = { methodology, unit: "NOK", baseline: "0", target: "50000", current: null, progressPercent: null, status: "insufficient_data", explanation: "Недостаточно данных",
  source: "manual", provenance: null, measurementCount: 0, updatedAt: "2026-11-16T10:00:00Z" };
const measured = { ...empty, current: "12000", progressPercent: 24, status: "measured", explanation: null, measurementCount: 1,
  provenance: { kind: "self_report", source: "manual", measurementId: "1d3f9f0e-5b7a-4c8e-9a4b-2f6d8c1e7a90", measuredAt: "2026-11-20T10:00:00Z", recordedAt: "2026-11-20T10:00:00Z", updatedAt: "2026-11-20T10:00:00Z" } };
const details = (overrides: Record<string, unknown>, progress: Record<string, unknown>) => goalDetailsSchema.parse({ goal: { ...goal, ...overrides }, progress });
const row = (value: ReturnType<typeof details>) => renderToStaticMarkup(createElement(GoalRow, { value, label: "Финансы", preferences, href: `/goals/${goal.id}`, selected: false, onDelete() {} }));
const interactive = /<(a|button|input|select|textarea)\b/g;

describe("goal row (mockup 32, LFS-224)", () => {
  it("is one link and one separate button, with nothing interactive inside the link", () => {
    const html = row(details({}, measured));
    expect(html.match(interactive)).toEqual(["a", "button"].map((tag) => `<${tag}`));
    const link = html.slice(html.indexOf("<a"), html.indexOf("</a>"));
    expect(link.slice(2)).not.toMatch(interactive);
    expect(link).toContain(`href="/goals/${goal.id}"`);
    expect(html).toContain('aria-label="Удалить цель «Накопить 50 000 NOK»"');
    expect(html).toContain("Финансы · до <time");
    expect(html).toMatch(/<progress[^>]*value="24"/); expect(html).toContain("24%");
    expect(html).toMatch(/12\s000 из 50\s000 NOK/);
    // The source moved to the panel; the row has no «+ Первое измерение».
    expect(html).not.toContain("ручной ввод"); expect(html).not.toContain("Первое измерение");
  });
  it("says «Нет данных» without a bar or a zero percentage, and asks for a measurement only while active", () => {
    const active = row(details({}, empty));
    expect(active).toContain("Нет данных"); expect(active).toContain("добавьте первое измерение");
    expect(active).not.toContain("<progress"); expect(active).not.toContain("0%");
    const archived = row(details({ status: "archived" }, empty));
    expect(archived).toContain("Нет данных"); expect(archived).toContain("В архиве");
    expect(archived).not.toContain("добавьте первое измерение");
    expect(archived.match(interactive)).toEqual(["<a", "<button"]);
  });
});

describe("goal panel progress (mockup 32)", () => {
  it("shows «Осталось» and the days to the deadline instead of the Старт / Сейчас / Цель tiles", () => {
    const html = renderToStaticMarkup(createElement(GoalProgressPanel, { value: details({}, measured), preferences, now: new Date("2026-11-22T12:00:00Z") }));
    expect(html).toContain("24%"); expect(html).toMatch(/12\s000 NOK из 50\s000 NOK/);
    expect(html).toMatch(/Осталось<\/span><strong[^>]*>38\s000 NOK/);
    expect(html).toContain("220 дней до срока");
    expect(html).not.toContain("Старт"); expect(html).not.toContain("<dl");
  });
  it("names a deadline that passed or is missing", () => {
    const render = (due_at: string | null) => renderToStaticMarkup(createElement(GoalProgressPanel, { value: details({ due_at }, empty), preferences, now: new Date("2026-11-22T12:00:00Z") }));
    expect(render(null)).toContain("срок не задан");
    expect(render("2026-11-01T22:59:59.999Z")).toContain("срок прошёл");
    expect(render(null)).not.toContain("Осталось");
  });
});
