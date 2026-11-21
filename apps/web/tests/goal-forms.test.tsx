import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GoalFields } from "../components/goals/goal-form.tsx";
import { GoalProgressPanel } from "../components/goals/goal-detail.tsx";
import { goalDetailsSchema, goalSchema } from "@lifeos/contracts";
import { goalFormInput, measurementFormInput } from "../lib/goal-form-input.ts";
import { formatGoalValue } from "../lib/goal-presentation.ts";
import { instantToLocalInput, resolveGoalTime, zonedInstantChoices } from "../lib/goal-time.ts";

const values = (input: Record<string, string>) => { const form = new FormData(); for (const [key, value] of Object.entries(input)) form.set(key, value); return form; };
const definition = { title: "Накопить 50 000 NOK", domain_key: "finance", baseline: "0", target: "50000", unit: "NOK", direction: "increase" };
const preferences = { timezone: "Europe/Oslo", locale: "ru" };
describe("goal form boundary and exact presentation", () => {
  it("normalizes the decimal separator without Number and sends only whitelisted goal fields", () => {
    const result = goalFormInput(values({ ...definition, baseline: "9007199254740993,01", target: "9007199254740993,02", user_id: "forged" }), "UTC");
    expect(result.data).toMatchObject({ baseline: "9007199254740993.01", target: "9007199254740993.02" });
    expect(result.data).not.toHaveProperty("user_id");
    // A date-only deadline (LFS-213) is the last millisecond of that day in the account's zone (Oslo: UTC+1 in winter).
    expect(goalFormInput(values({ ...definition, due_at: "2026-12-01" }), preferences.timezone).data?.due_at).toBe("2026-12-01T22:59:59.999Z");
    expect(goalFormInput(values({ ...definition, due_at: "2026-07-01" }), preferences.timezone).data?.due_at).toBe("2026-07-01T21:59:59.999Z");
  });
  it("keeps a stored deadline whose date is unchanged and moves an edited one to the end of the new day", () => {
    const original = "2026-12-01T09:30:00.000Z";
    const edit = (due_at: string) => goalFormInput(values({ title: definition.title, due_at, due_at_original: original }), preferences.timezone, true).data?.due_at;
    expect(edit("2026-12-01")).toBe(original);
    expect(edit("2026-12-02")).toBe("2026-12-02T22:59:59.999Z");
    expect(edit("")).toBeNull();
    expect(goalFormInput(values({ ...definition, due_at: "2026-13-01" }), preferences.timezone).errors).toHaveProperty("due_at");
  });
  it.each([{ target: "0" }, { target: "1.001" }, { baseline: "-1" }, { target: "1e5" }, { unit: "custom" }, { domain_key: "" }, { title: " " }])(
    "returns field errors before sending invalid goal %j", (change) => { expect(goalFormInput(values({ ...definition, ...change }), "UTC").errors).toBeTruthy(); },
  );
  it("sends a definition on edit only when the form shows it (LFS-217) and explicitly clears the due date", () => {
    const shown = { title: definition.title, baseline: definition.baseline, target: definition.target, unit: definition.unit, direction: definition.direction };
    expect(goalFormInput(values({ title: definition.title, description: " Changed " }), "UTC", true).data).toEqual({ title: definition.title, description: "Changed", due_at: null });
    expect(goalFormInput(values({ ...shown, baseline: "1000,5" }), "UTC", true).data)
      .toEqual({ title: definition.title, description: null, due_at: null, unit: "NOK", unit_label: null, baseline: "1000.5", target: "50000", direction: "increase" });
    expect(goalFormInput(values({ ...shown, target: "0" }), "UTC", true).errors).toHaveProperty("target");
  });
  it("keeps manual measurement values exact and normalizes account-local time", () => {
    expect(measurementFormInput(values({ value: "9007199254740993,01", measured_at: "2026-01-02T10:00", note: " Note " }), preferences.timezone).data)
      .toEqual({ value: "9007199254740993.01", measured_at: "2026-01-02T09:00:00.000Z", note: "Note", source: "manual" });
    expect(measurementFormInput(values({ value: "-1", measured_at: "2026-01-02T10:00" }), "UTC").errors).toHaveProperty("value");
    expect(measurementFormInput(values({ value: "0" }), "UTC").errors).toHaveProperty("measured_at");
  });
  it("formats all significant decimal digits without floating point truncation", () => {
    expect(formatGoalValue("9007199254740993.01", { unit: "NOK", unit_label: null }, "en-GB")).toBe("9,007,199,254,740,993.01 NOK");
    expect(formatGoalValue("0.00000001", { unit: "custom", unit_label: "км" }, "en-GB")).toBe("0.00000001 км");
  });
  it("renders labeled decimal text fields, timezone hints and accessible field errors", () => {
    const html = renderToStaticMarkup(createElement(GoalFields, { domains: [{ key: "finance", label: "Финансы" }], preferences, errors: { target: "Проверьте цель" } }));
    expect(html).toContain('type="text"'); expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('aria-describedby="target-error"'); expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('for="target"'); expect(html).toContain("Europe/Oslo"); expect(html).not.toContain('type="number"');
  });
  it("labels the deadline optional and shows the definition on edit only while the goal has no measurements", () => {
    const goal = goalSchema.parse({ ...definition, id: "4fe63a56-7a7f-4905-bdc3-c9dff1d439dc", user_id: "owner", status: "active",
      created_at: "2026-11-16T10:00:00.000Z", updated_at: "2026-11-16T10:00:00.000Z" });
    const render = (definitionEditable: boolean) => renderToStaticMarkup(createElement(GoalFields, { initial: goal, definitionEditable, domains: [], preferences, errors: {} }));
    expect(render(true)).toContain('id="unit"'); expect(render(true)).toContain('value="50000"'); expect(render(true)).toContain("Срок · необязательно");
    expect(render(false)).not.toContain('id="unit"'); expect(render(false)).not.toContain('id="baseline"');
    expect(render(false)).toContain("Старт и цель фиксируются после первого измерения"); expect(render(false)).toContain("Срок · необязательно");
  });
  it("renders the no-data state without a zero-percent progress bar", () => {
    const value = goalDetailsSchema.parse({ goal: { ...definition, id: "4fe63a56-7a7f-4905-bdc3-c9dff1d439dc", user_id: "owner", status: "active", created_at: "2026-11-16T10:00:00Z", updated_at: "2026-11-16T10:00:00Z" },
      progress: { methodology: { version: 1, mode: "manual", formula: "(current-baseline)/(target-baseline)", percentDecimals: 2, rounding: "half_up", clamped: true },
        unit: "NOK", baseline: "0", target: "50000", current: null, progressPercent: null, status: "insufficient_data", explanation: "Недостаточно данных",
        source: "manual", provenance: null, measurementCount: 0, updatedAt: "2026-11-16T10:00:00Z" } });
    const html = renderToStaticMarkup(createElement(GoalProgressPanel, { value, preferences }));
    expect(html).toContain("Недостаточно данных"); expect(html).not.toContain("<progress"); expect(html).not.toContain("0%");
  });
});
describe("account-local date fields", () => {
  it("roundtrips UTC instants including milliseconds in a zone different from the browser", () => {
    const instant = "2026-07-15T09:12:13.123Z";
    const local = instantToLocalInput(instant, preferences.timezone);
    expect(local).toBe("2026-07-15T11:12:13.123");
    expect(resolveGoalTime(local, preferences.timezone, null)).toBe(instant);
  });
  it("rejects nonexistent wall time and requires an explicit choice for ambiguous DST time", () => {
    expect(zonedInstantChoices("2026-03-29T02:30", preferences.timezone)).toEqual([]);
    expect(() => resolveGoalTime("2026-03-29T02:30", preferences.timezone, null)).toThrow("существующие");
    const choices = zonedInstantChoices("2026-10-25T02:30", preferences.timezone);
    expect(choices.map((choice) => choice.offset)).toEqual(["UTC+02:00", "UTC+01:00"]);
    expect(() => resolveGoalTime("2026-10-25T02:30", preferences.timezone, null)).toThrow("смещение");
    expect(resolveGoalTime("2026-10-25T02:30", preferences.timezone, "UTC+01:00")).toBe("2026-10-25T01:30:00.000Z");
  });
});

describe("example goals in the forms (LFS-218)", () => {
  const goal = goalSchema.parse({ id: "4fe63a56-7a7f-4905-bdc3-c9dff1d439dc", user_id: "owner", domain_key: "finance", title: "Накопить 5 000 $", unit: "USD",
    baseline: "0", target: "5000", direction: "increase", status: "active", origin: "starter", created_at: "2026-11-18T19:40:00.000Z", updated_at: "2026-11-18T19:40:00.000Z" });
  const preferences = { timezone: "Europe/Oslo", locale: "ru" };
  it("offers USD and warns that a new definition removes the example value", () => {
    const html = renderToStaticMarkup(createElement(GoalFields, { initial: goal, definitionEditable: true, replacesExample: true, domains: [], preferences, errors: {} }));
    expect(html).toContain('<option value="USD" selected="">USD ($)</option>');
    expect(html).toContain("примерное измерение удалится");
    expect(renderToStaticMarkup(createElement(GoalFields, { initial: goal, definitionEditable: true, domains: [], preferences, errors: {} }))).not.toContain("примерное измерение удалится");
  });
  it("keeps dollars to two decimal places before sending", () => {
    const definition = { title: goal.title, baseline: "0", target: "5000,25", unit: "USD", direction: "increase" };
    expect(goalFormInput(values(definition), "UTC", true).data).toMatchObject({ unit: "USD", target: "5000.25" });
    expect(goalFormInput(values({ ...definition, target: "5000,255" }), "UTC", true).errors).toHaveProperty("target");
  });
});
