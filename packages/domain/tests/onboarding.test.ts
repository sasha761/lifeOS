import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { goalSchema } from "@lifeos/contracts";
import type { ActivityEventDraft, Goal, OnboardingAnswers } from "@lifeos/contracts";
import { actorFromVerifiedSession, ConflictError, createOnboardingService, InvalidInputError, isDomainError, NotFoundError } from "../src/index.ts";
import type { OnboardingCommand, OnboardingStateRecord, OnboardingTransaction, OnboardingUnitOfWork } from "../src/index.ts";

const actor = actorFromVerifiedSession("owner");
const options = { idempotencyKey: "onboarding-1", source: "web" };
const now = "2026-11-20T10:00:00.000Z";
const choice = (option: string, values: Record<string, unknown> = {}) =>
  ({ option, subject: "", direction: "increase", unit: "custom", unit_label: "", baseline: "", target: "", due_at: null, ...values });
const answers = {
  step: "summary", domains: ["finance", "skills", "health"], rhythm: "few_per_week", timezone: null, unchecked: [],
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

function fixture(stored: OnboardingStateRecord | null = null, outcome: "success" | "conflict" = "success") {
  const goals: Goal[] = []; const events: ActivityEventDraft[] = []; const commands: OnboardingCommand[] = [];
  const completed: OnboardingAnswers[] = [];
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
    state: { find: vi.fn(async () => stored), saveDraft: vi.fn(async (owner, value, version) => record({ user_id: owner.userId, answers: value, catalog_version: version })) },
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
    expect(transaction.profile.applyOnboarding).toHaveBeenCalledWith(actor, { focusDomains: ["finance", "skills", "health"], checkinRhythm: "few_per_week", timezone: null });
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

  it("checks the confirmed time zone and the transport context", async () => {
    const { service, transaction } = fixture();
    const zone = await rejected(service.complete(actor, { answers: { ...answers, timezone: "Mars/Olympus" }, selected }, options));
    expect(isDomainError(zone) && zone.field).toBe("timezone");
    expect(await rejected(service.complete(actor, { answers, selected }, { idempotencyKey: "bad key", source: "web" }))).toBeInstanceOf(InvalidInputError);
    expect(await rejected(service.complete(actor, { answers, selected: [] }, options))).toBeInstanceOf(InvalidInputError);
    await service.complete(actor, { answers: { ...answers, timezone: "europe/oslo" }, selected }, options);
    expect(transaction.profile.applyOnboarding).toHaveBeenCalledWith(actor, expect.objectContaining({ timezone: "Europe/Oslo" }));
  });

  it("turns a reused key with other data into a conflict", async () => {
    expect(await rejected(fixture(null, "conflict").service.complete(actor, { answers, selected }, options))).toBeInstanceOf(ConflictError);
  });
});
