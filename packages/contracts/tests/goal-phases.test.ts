import { describe, expect, it } from "vitest";
import {
  activityEntrySchema, activityEventDraftSchema, createGoalInputSchema, GOAL_PHASE_LABELS, goalAuditSnapshotSchema, goalDetailsSchema, goalSchema,
  patchGoalInputSchema, updateGoalInputSchema,
} from "../src/index.ts";

// LFS-225 (ADR-013): goals without measurements, the person's phase of a goal and the start date.
const id = "4fe63a56-7a7f-4905-bdc3-c9dff1d439dc";
const time = "2026-11-15T10:00:00.000Z";
const numericInput = { domain_key: "finance", title: "Save", unit: "NOK", baseline: "0", target: "50000", direction: "increase" };
const unmeasuredInput = { kind: "unmeasured", domain_key: "work", title: "Найти новую работу" };
const stored = { id, user_id: "owner", status: "active", origin: "manual", phase: "in_progress", phase_changed_at: time, created_at: time, updated_at: time,
  calculation_mode: "manual", metric_key: null, description: null, starts_at: null, due_at: null };
const unmeasuredGoal = { ...stored, kind: "unmeasured", domain_key: "work", title: "Найти работу", unit: null, unit_label: null, baseline: null, target: null, direction: null };
const numericGoal = { ...stored, kind: "numeric", ...numericInput, unit_label: null };
const methodology = { version: 1, mode: "manual", formula: "(current-baseline)/(target-baseline)", percentDecimals: 2, rounding: "half_up", clamped: true };
const unmeasuredProgress = { methodology: null, source: "manual", provenance: null, unit: null, baseline: null, target: null, current: null,
  status: "unmeasured", progressPercent: null, explanation: "В процессе", updatedAt: time, measurementCount: 0 };
const numericProgress = { methodology, source: "manual", provenance: null, unit: "NOK", baseline: "0", target: "50000", current: null,
  status: "insufficient_data", progressPercent: null, explanation: "Недостаточно данных", updatedAt: time, measurementCount: 0 };

describe("goal kinds (LFS-225)", () => {
  it("creates a goal without measurements without any numbers, and a numeric goal without kind as before", () => {
    expect(createGoalInputSchema.parse(unmeasuredInput)).toEqual({ ...unmeasuredInput, description: null, calculation_mode: "manual", metric_key: null, starts_at: null, due_at: null });
    expect(createGoalInputSchema.parse(numericInput).kind).toBe("numeric");
    expect(createGoalInputSchema.parse({ ...numericInput, kind: "numeric" }).kind).toBe("numeric");
  });
  it.each([
    ["a unit", { unit: "NOK" }], ["a start value", { baseline: "0" }], ["a target", { target: "10" }], ["a direction", { direction: "increase" }],
    ["a null unit", { unit: null }], ["all numbers", { unit: "NOK", baseline: "0", target: "10", direction: "increase" }],
  ])("rejects a goal without measurements with %s", (_name, numbers) => {
    expect(createGoalInputSchema.safeParse({ ...unmeasuredInput, ...numbers }).success).toBe(false);
  });
  it("rejects a numeric goal without its numbers and an unknown kind", () => {
    expect(createGoalInputSchema.safeParse({ ...numericInput, kind: "unmeasured" }).success).toBe(false);
    expect(createGoalInputSchema.safeParse({ domain_key: "work", title: "No kind, no numbers" }).success).toBe(false);
    expect(createGoalInputSchema.safeParse({ ...unmeasuredInput, kind: "checklist" }).success).toBe(false);
  });
  it("stores both kinds: a goal without measurements has every definition field null", () => {
    expect(goalSchema.parse(unmeasuredGoal)).toMatchObject({ kind: "unmeasured", unit: null, baseline: null, phase: "in_progress" });
    expect(goalSchema.safeParse({ ...unmeasuredGoal, unit: "NOK" }).success).toBe(false);
    expect(goalSchema.safeParse({ ...numericGoal, baseline: null }).success).toBe(false);
    expect(goalSchema.safeParse({ ...unmeasuredGoal, phase: "done" }).success).toBe(false);
  });
  it("reads an older stored goal as numeric and in progress since its creation", () => {
    const older = Object.fromEntries(Object.entries(numericGoal).filter(([key]) => !["kind", "phase", "phase_changed_at", "starts_at"].includes(key)));
    const created = "2026-11-01T08:00:00.000Z";
    expect(goalSchema.parse({ ...older, created_at: created })).toMatchObject({ kind: "numeric", phase: "in_progress", phase_changed_at: created, starts_at: null });
  });
});

describe("start date (LFS-225)", () => {
  const start = "2026-12-01T00:00:00+01:00";
  it("accepts a start up to the deadline for both kinds", () => {
    expect(createGoalInputSchema.parse({ ...unmeasuredInput, starts_at: start, due_at: "2026-12-01T00:00:00+01:00" }).starts_at).toBe("2026-11-30T23:00:00.000Z");
    expect(createGoalInputSchema.safeParse({ ...numericInput, starts_at: start, due_at: "2027-03-01T22:59:59.999Z" }).success).toBe(true);
    expect(updateGoalInputSchema.parse({ starts_at: start }).starts_at).toBe("2026-11-30T23:00:00.000Z");
    expect(updateGoalInputSchema.parse({ starts_at: null })).toEqual({ starts_at: null });
  });
  it("rejects a start after the deadline in creation, edit and the stored goal", () => {
    const late = { starts_at: "2027-01-02T00:00:00.000Z", due_at: "2027-01-01T22:59:59.999Z" };
    expect(createGoalInputSchema.safeParse({ ...unmeasuredInput, ...late }).success).toBe(false);
    expect(createGoalInputSchema.safeParse({ ...numericInput, ...late }).success).toBe(false);
    expect(updateGoalInputSchema.safeParse(late).success).toBe(false);
    expect(goalSchema.safeParse({ ...unmeasuredGoal, ...late }).success).toBe(false);
    expect(createGoalInputSchema.safeParse({ ...unmeasuredInput, starts_at: "2026-12-01" }).success).toBe(false);
  });
});

describe("phase command and progress (LFS-225)", () => {
  it("is a PATCH of its own: only `{ phase }` with a known phase", () => {
    expect(patchGoalInputSchema.parse({ phase: "achieved" })).toEqual({ phase: "achieved" });
    for (const body of [{ phase: "archived" }, { phase: "achieved", title: "x" }, { phase: "paused", status: "archived" }, { phase: null }]) {
      expect(patchGoalInputSchema.safeParse(body).success).toBe(false);
    }
  });
  it("gives a goal without measurements no percentage: its explanation is the phase", () => {
    expect(goalDetailsSchema.safeParse({ goal: unmeasuredGoal, progress: unmeasuredProgress }).success).toBe(true);
    const achieved = { goal: { ...unmeasuredGoal, phase: "achieved" }, progress: { ...unmeasuredProgress, explanation: GOAL_PHASE_LABELS.achieved } };
    expect(goalDetailsSchema.safeParse(achieved).success).toBe(true);
    expect(goalDetailsSchema.safeParse({ ...achieved, progress: unmeasuredProgress }).success).toBe(false);
    expect(goalDetailsSchema.safeParse({ goal: unmeasuredGoal, progress: numericProgress }).success).toBe(false);
    expect(goalDetailsSchema.safeParse({ goal: numericGoal, progress: { ...numericProgress, status: "unmeasured", explanation: "В процессе" } }).success).toBe(false);
    expect(goalDetailsSchema.safeParse({ goal: unmeasuredGoal, progress: { ...unmeasuredProgress, methodology } }).success).toBe(false);
    expect(goalDetailsSchema.safeParse({ goal: numericGoal, progress: numericProgress }).success).toBe(true);
  });
});

describe("audit of phases and dates (LFS-225)", () => {
  const before = { unit: null, baseline: null, target: null, direction: null, status: "active", due_at: null, kind: "unmeasured", phase: "in_progress", starts_at: null };
  const event = (payload: Record<string, unknown>) => ({ goal_id: id, domain_key: "work", target_id: id, schema_version: 1, event_type: "goal.updated", target_type: "goal", payload });
  it("keeps older snapshots without kind, phase and start valid", () => {
    expect(goalAuditSnapshotSchema.safeParse({ unit: "NOK", baseline: "0", target: "10", direction: "increase", status: "active", due_at: null }).success).toBe(true);
    expect(goalAuditSnapshotSchema.safeParse(before).success).toBe(true);
  });
  it("writes a phase change as its own goal.updated with both phases", () => {
    expect(activityEventDraftSchema.safeParse(event({ before, after: { ...before, phase: "achieved" }, changed_fields: ["phase"] })).success).toBe(true);
    expect(activityEventDraftSchema.safeParse(event({ before, after: { ...before, phase: "achieved" }, changed_fields: ["phase", "title"] })).success).toBe(false);
    expect(activityEventDraftSchema.safeParse(event({ before, after: before, changed_fields: ["phase"] })).success).toBe(false);
    const withoutPhase = Object.fromEntries(Object.entries(before).filter(([key]) => key !== "phase"));
    expect(activityEventDraftSchema.safeParse(event({ before: withoutPhase, after: { ...before, phase: "paused" }, changed_fields: ["phase"] })).success).toBe(false);
  });
  it("shows the phase and the start date of an edit in the journal only when they changed", () => {
    const entry = { id: "5fe63a56-7a7f-4905-bdc3-c9dff1d439dc", type: "goal.updated", occurredAt: time, source: "web", domainKey: "work",
      goal: { id, title: "Найти работу", status: "active" }, measurement: null, changedFields: ["phase"], startsAt: null, dueAt: null, definition: null,
      phase: { before: "in_progress", after: "achieved" }, example: false };
    expect(activityEntrySchema.safeParse(entry).success).toBe(true);
    expect(activityEntrySchema.safeParse({ ...entry, phase: null }).success).toBe(false);
    expect(activityEntrySchema.safeParse({ ...entry, changedFields: ["starts_at"], phase: null, startsAt: { before: null, after: time } }).success).toBe(true);
    expect(activityEntrySchema.safeParse({ ...entry, changedFields: ["title"], phase: null, startsAt: { before: null, after: time } }).success).toBe(false);
  });
});
