import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { goalSchema } from "@lifeos/contracts";
import type { ActivityEventDraft, Goal, OnboardingAnswers } from "@lifeos/contracts";
import { actorFromVerifiedSession, ConflictError, createOnboardingService, InvalidInputError, isDomainError, NotFoundError, readStoredOnboardingAnswers } from "../src/index.ts";
import type { OnboardingCommand, OnboardingOverviewRecord, OnboardingStateRecord, OnboardingTransaction, OnboardingUnitOfWork } from "../src/index.ts";

const actor = actorFromVerifiedSession("owner");
const options = { idempotencyKey: "onboarding-1", source: "web" };
const now = "2026-11-20T10:00:00.000Z";
const choice = (option: string, values: Record<string, unknown> = {}) =>
  ({ option, subject: "", direction: "increase", unit: "custom", unit_label: "", baseline: "", target: "", due_at: null, ...values });
const answers = {
  step: "summary", domains: ["finance", "skills", "health"], unchecked: [],
  extra: [{ domain_key: "work", title: "Отклики", unit: "count", baseline: "0", target: "10", direction: "increase" }],
  spheres: {
    finance: { skipped: false, choices: [choice("emergency_fund", { unit: "USD", target: "3000", baseline: "500", due_at: "2027-06-30T21:59:59.999Z" })] },
    skills: { skipped: true, choices: [] },
    health: { skipped: false, choices: [choice("training", { baseline: "0", target: "3" }), choice("own", { subject: "Пробежать полумарафон", unit_label: "км", baseline: "5", target: "21,1" })] },
  },
};
const selected = ["finance.emergency_fund", "health.training", "health.own", "extra.0"];
const record = (values: Partial<OnboardingStateRecord> = {}): OnboardingStateRecord =>
  ({ user_id: actor.userId, status: "in_progress", choice: "wizard", answers, catalog_version: 1, completed_at: null, updated_at: now, ...values });

const counts = { total: 0, onboarding: 0, examples: 0 };
const overviewOf = (state: OnboardingStateRecord | null, values: Partial<OnboardingOverviewRecord> = {}): OnboardingOverviewRecord =>
  ({ state, focusDomains: null, goals: counts, ...values });

function fixture(stored: OnboardingStateRecord | null = null, outcome: "success" | "conflict" = "success", profile: Partial<OnboardingOverviewRecord> = {}) {
  const goals: Goal[] = []; const events: ActivityEventDraft[] = []; const commands: OnboardingCommand[] = [];
  const completed: OnboardingAnswers[] = [];
  let current = stored;
  const transaction: OnboardingTransaction = {
    goals: { create: vi.fn(async (owner, input, { origin = "manual" } = {}) => {
      const goal = goalSchema.parse({ ...input, id: randomUUID(), user_id: owner.userId, status: "active", origin, created_at: now, updated_at: now });
      goals.push(goal); return goal;
    }) },
    events: { append: vi.fn(async (event) => { events.push(event); }) },
    state: { complete: vi.fn(async (owner, value, version) => { completed.push(value); return record({ user_id: owner.userId, status: "completed", answers: value, catalog_version: version, completed_at: now }); }) },
    profile: { applyOnboarding: vi.fn(async () => true) },
  };
  const unit: OnboardingUnitOfWork = {
    state: {
      saveDraft: vi.fn(async (owner, value, version) => (current = record({ user_id: owner.userId, answers: value, catalog_version: version }))),
      // The conditional write of the database: a completed setup refuses a start choice.
      choose: vi.fn(async (owner, value, version) => {
        if (current?.status === "completed") return null;
        current = record({ answers: null, ...current, user_id: owner.userId, status: value === "wizard" ? "in_progress" : "dismissed", choice: value,
          catalog_version: current?.catalog_version ?? version });
        return current;
      }),
    },
    overview: { read: vi.fn(async () => overviewOf(current, profile)) },
    run: vi.fn<OnboardingUnitOfWork["run"]>(async (_actor, command, operation) => {
      commands.push(command);
      return outcome === "conflict" ? { kind: "conflict" } : { kind: "success", result: await operation(transaction) };
    }),
  };
  return { service: createOnboardingService(unit), unit, transaction, goals, events, commands, completed };
}
async function rejected(promise: Promise<unknown>) {
  try { await promise; } catch (error) { return error; }
  throw new Error("Expected a rejection.");
}

describe("onboarding state and draft (LFS-219)", () => {
  it("reads a missing row as not started and a draft of another catalog version as none", async () => {
    expect(await fixture().service.get(actor)).toMatchObject({ status: "not_started", choice: null, answers: null, updated_at: null });
    expect((await fixture(record()).service.get(actor)).answers?.step).toBe("summary");
    expect((await fixture(record({ catalog_version: 2 })).service.get(actor)).answers).toBeNull();
    expect((await fixture(record({ answers: { step: "nowhere" } })).service.get(actor)).answers).toBeNull();
    expect(await rejected(fixture(record({ user_id: "other" })).service.get(actor))).toBeInstanceOf(NotFoundError);
  });

  it("carries the profile values of the setup and the goal counts; a missing profile row is not found (LFS-220)", async () => {
    const state = await fixture(record({ status: "completed", completed_at: now }), "success",
      { focusDomains: ["health", "finance", "unknown"], goals: { total: 9, onboarding: 4, examples: 2 } }).service.get(actor);
    expect(state).toMatchObject({ focus_domains: ["finance", "health"], goals: { total: 9, onboarding: 4, examples: 2 } });
    expect(state).not.toHaveProperty("checkin_rhythm");
    const missing = fixture(); missing.unit.overview.read = vi.fn(async () => null);
    expect(await rejected(missing.service.get(actor))).toBeInstanceOf(NotFoundError);
  });

  it("validates a draft before storing it, with the current catalog version", async () => {
    const { service, unit } = fixture();
    expect(await rejected(service.saveDraft(actor, { answers: { ...answers, user_id: "other" } }))).toBeInstanceOf(InvalidInputError);
    expect(await rejected(service.saveDraft(actor, answers))).toBeInstanceOf(InvalidInputError);
    expect(unit.state.saveDraft).not.toHaveBeenCalled();
    const state = await service.saveDraft(actor, { answers });
    expect(state).toMatchObject({ status: "in_progress", choice: "wizard", catalog_version: 1 });
    expect(unit.state.saveDraft).toHaveBeenCalledWith(actor, expect.objectContaining({ step: "summary" }), 1);
  });
});

describe("drafts saved with the rhythm step (LFS-222)", () => {
  const legacy = { ...answers, step: "rhythm", rhythm: "weekly", timezone: "Europe/Oslo" };

  it("drops the rhythm and the zone of a stored draft and resumes the rhythm step on the summary", async () => {
    // The same draft as one saved without the old keys, read by the current schema (with its defaults).
    const current = readStoredOnboardingAnswers(answers);
    expect(current).not.toBeNull();
    expect(readStoredOnboardingAnswers(legacy)).toEqual(current);
    expect(readStoredOnboardingAnswers({ ...legacy, step: "health" })?.step).toBe("health");
    const state = await fixture(record({ answers: legacy })).service.get(actor);
    expect(state.answers).toEqual(current);
    expect(state.answers).not.toHaveProperty("rhythm");
    expect(state.answers).not.toHaveProperty("timezone");
  });

  it("still refuses a stored draft that is broken in another way, and a new draft or completion with the old keys", async () => {
    for (const stored of [null, [], "draft", { ...legacy, step: "nowhere" }, { ...legacy, user_id: "other" }]) {
      expect(readStoredOnboardingAnswers(stored)).toBeNull();
    }
    const { service, unit } = fixture();
    expect(await rejected(service.saveDraft(actor, { answers: { ...answers, rhythm: "weekly" } }))).toBeInstanceOf(InvalidInputError);
    expect(await rejected(service.saveDraft(actor, { answers: { ...answers, step: "rhythm" } }))).toBeInstanceOf(InvalidInputError);
    expect(await rejected(service.complete(actor, { answers: { ...answers, timezone: "Europe/Oslo" }, selected }, options))).toBeInstanceOf(InvalidInputError);
    expect(unit.state.saveDraft).not.toHaveBeenCalled();
    expect(unit.run).not.toHaveBeenCalled();
  });
});

describe("start choice (LFS-220)", () => {
  it("moves a new, started or dismissed setup to the chosen state and keeps the draft", async () => {
    const { service, unit } = fixture();
    expect(await service.update(actor, { status: "in_progress", choice: "wizard" })).toMatchObject({ status: "in_progress", choice: "wizard", answers: null });
    expect(await service.update(actor, { status: "dismissed", choice: "blank" })).toMatchObject({ status: "dismissed", choice: "blank" });
    expect(await service.update(actor, { status: "dismissed", choice: "blank" })).toMatchObject({ status: "dismissed", choice: "blank" });
    expect(unit.state.choose).toHaveBeenLastCalledWith(actor, "blank", 1);
    const started = fixture(record());
    expect((await started.service.update(actor, { status: "dismissed", choice: "blank" })).answers?.step).toBe("summary");
  });

  it("refuses to reopen or dismiss a completed setup with a conflict", async () => {
    for (const change of [{ status: "in_progress", choice: "wizard" }, { status: "dismissed", choice: "blank" }]) {
      const { service } = fixture(record({ status: "completed", completed_at: now }));
      expect(await rejected(service.update(actor, change))).toBeInstanceOf(ConflictError);
      expect(await service.get(actor)).toMatchObject({ status: "completed", choice: "wizard" });
    }
  });

  it("accepts only the pairs of the popup, never the removed rhythm, an owner id or another status", async () => {
    const { service, unit } = fixture();
    for (const input of [{}, { status: "completed", choice: "example" }, { status: "in_progress", choice: "blank" }, { status: "not_started", choice: null },
      { checkin_rhythm: "weekly" }, { checkin_rhythm: "weekly", status: "dismissed", choice: "blank" }, { status: "dismissed", choice: "blank", user_id: "other" }]) {
      expect(await rejected(service.update(actor, input))).toBeInstanceOf(InvalidInputError);
    }
    expect(unit.state.choose).not.toHaveBeenCalled();
  });
});

describe("«Создать N целей» (LFS-219)", () => {
  it("creates exactly the ticked goals as onboarding goals with their audit, no measurement, and completes the setup", async () => {
    const { service, goals, events, commands, completed, transaction } = fixture();
    expect(await service.complete(actor, { answers, selected: ["health.own", "finance.emergency_fund", "extra.0"] }, options))
      .toEqual({ catalog_version: 1, created_goals: 3 });
    // Proposal order, not click order: spheres in registry order, the extra goals last.
    expect(goals.map((goal) => [goal.title, goal.origin])).toEqual([["Подушка безопасности", "onboarding"], ["Пробежать полумарафон", "onboarding"], ["Отклики", "onboarding"]]);
    expect(goals[1]).toMatchObject({ unit: "custom", unit_label: "км", baseline: "5", target: "21.1" });
    expect(events.map((event) => [event.event_type, event.goal_id])).toEqual(goals.map((goal) => ["goal.created", goal.id]));
    expect(commands[0]).toMatchObject({ operation: "onboarding.complete", source: "web", idempotencyKey: "onboarding-1", targetId: null });
    // Only «сферы в фокусе»: the time zone is not written by the setup (LFS-222).
    expect(transaction.profile.applyOnboarding).toHaveBeenCalledExactlyOnceWith(actor, { focusDomains: ["finance", "skills", "health"] });
    expect(completed[0]).toMatchObject({ step: "domains", extra: [], unchecked: [], domains: ["finance", "skills", "health"] });
    expect(completed[0]?.spheres.health?.choices).toHaveLength(2);
  });

  it("names the first goal that does not pass and creates none; an unknown key is rejected the same way", async () => {
    const invalid = { ...answers, spheres: { ...answers.spheres, health: { skipped: false, choices: [choice("training", { baseline: "3", target: "3" })] } } };
    const first = fixture();
    const error = await rejected(first.service.complete(actor, { answers: invalid, selected: ["finance.emergency_fund", "health.training"] }, options));
    expect(isDomainError(error) && error.code === "VALIDATION_ERROR" && error.field).toBe("health.training");
    expect(first.unit.run).not.toHaveBeenCalled();
    const second = fixture();
    const unknown = await rejected(second.service.complete(actor, { answers, selected: ["skills.chess"] }, options));
    expect(isDomainError(unknown) && unknown.field).toBe("skills.chess");
    expect(second.goals).toEqual([]);
  });

  it("checks the transport context and the ticked goals", async () => {
    const { service, unit } = fixture();
    expect(await rejected(service.complete(actor, { answers, selected }, { idempotencyKey: "bad key", source: "web" }))).toBeInstanceOf(InvalidInputError);
    expect(await rejected(service.complete(actor, { answers, selected: [] }, options))).toBeInstanceOf(InvalidInputError);
    expect(unit.run).not.toHaveBeenCalled();
  });

  it("turns a reused key with other data into a conflict", async () => {
    expect(await rejected(fixture(null, "conflict").service.complete(actor, { answers, selected }, options))).toBeInstanceOf(ConflictError);
  });
});
