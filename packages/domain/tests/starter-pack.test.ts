import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createGoalInputSchema, DOMAIN_KEYS, goalMeasurementSchema, goalSchema, goalValueMatchesUnit } from "@lifeos/contracts";
import type { ActivityEventDraft, Goal, GoalMeasurement } from "@lifeos/contracts";
import {
  actorFromVerifiedSession, ConflictError, createStarterPackService, InvalidInputError, STARTER_PACK, STARTER_PACK_NOTE,
} from "../src/index.ts";
import type { OnboardingStateRecord, StarterPackCommand, StarterPackTransaction, StarterPackUnitOfWork } from "../src/index.ts";

const actor = actorFromVerifiedSession("owner");
const options = { idempotencyKey: "starter-1", source: "web" };
const now = new Date("2026-11-18T19:40:00.000Z");

describe("example set version 1 (LFS-218)", () => {
  it("passes the goal creation contract and the unit rules of a manual measurement, in all six spheres, without deadlines", () => {
    expect(STARTER_PACK).toHaveLength(7);
    for (const { goal, example } of STARTER_PACK) {
      const parsed = createGoalInputSchema.parse(goal);
      expect(parsed.due_at).toBeNull();
      expect(goalValueMatchesUnit(example, parsed.unit)).toBe(true);
    }
    expect(new Set(STARTER_PACK.map(({ goal }) => goal.domain_key))).toEqual(new Set(DOMAIN_KEYS));
    expect(STARTER_PACK.map(({ goal }) => goal.title)).toEqual(["Накопить 5 000 $", "Английский до уровня B2", "Ходить в зал 3 раза в неделю",
      "Бокс раз в неделю", "Рейтинг Lichess 1500", "Прочитать 6 книг по профессии", "Запустить личный проект"]);
  });
});

function fixture(existingExamples = 0, setupCompleted = false) {
  const goals: Goal[] = []; const measurements: GoalMeasurement[] = []; const events: ActivityEventDraft[] = [];
  let examples = existingExamples;
  const commands: StarterPackCommand[] = [];
  const starts: string[] = [];
  const transaction: StarterPackTransaction = {
    goals: { create: vi.fn(async (owner, input, { origin = "manual" } = {}) => {
      const goal = goalSchema.parse({ ...input, id: randomUUID(), user_id: owner.userId, status: "active", origin, created_at: now.toISOString(), updated_at: now.toISOString() });
      goals.push(goal); return goal;
    }) },
    measurements: { create: vi.fn(async (owner, goal, input) => {
      const measurement = goalMeasurementSchema.parse({ ...input, id: randomUUID(), goal_id: goal.id, user_id: owner.userId, unit: goal.unit,
        created_at: now.toISOString(), updated_at: now.toISOString() });
      measurements.push(measurement); return measurement;
    }) },
    examples: { countExamples: vi.fn(async () => examples), deleteExamples: vi.fn(async () => { const removed = examples; examples = 0; return { goals: removed, measurements: removed }; }) },
    events: { append: vi.fn(async (event) => { events.push(event); }) },
    // A completed setup is left as it is (null); otherwise the example completes it (LFS-220).
    onboarding: { completeWithExample: vi.fn(async (owner, version): Promise<OnboardingStateRecord | null> => {
      starts.push(`${owner.userId}:${version}`);
      return setupCompleted ? null : { user_id: owner.userId, status: "completed", choice: "example", answers: null, catalog_version: version,
        completed_at: now.toISOString(), updated_at: now.toISOString() };
    }) },
  };
  const unit: StarterPackUnitOfWork = { run: vi.fn<StarterPackUnitOfWork["run"]>(async (_actor, command, operation) => { commands.push(command); return { kind: "success", result: await operation(transaction) }; }) };
  return { goals, measurements, events, commands, starts, transaction, unit, service: createStarterPackService(unit, () => now) };
}

describe("loading the example", () => {
  it("creates the seven example goals and values with the creation rules and audit of manual ones, the first entry newest", async () => {
    const { service, goals, measurements, events, commands } = fixture();
    expect(await service.apply(actor, options)).toEqual({ version: 1, created_goals: 7, created_measurements: 7 });
    expect(commands).toEqual([{ ...options, operation: "starter_pack.apply", targetId: null, input: { version: 1 }, eventSource: "starter" }]);
    expect(goals.map((goal) => goal.title)).toEqual(STARTER_PACK.map(({ goal }) => goal.title).reverse());
    expect(goals.every((goal) => goal.origin === "starter" && goal.due_at === null && goal.user_id === actor.userId)).toBe(true);
    expect(measurements.map((value) => [value.goal_id, value.value, value.source, value.note, value.measured_at]))
      .toEqual(goals.map((goal) => [goal.id, STARTER_PACK.find((entry) => entry.goal.title === goal.title)!.example, "example", STARTER_PACK_NOTE, now.toISOString()]));
    // Goals first, then values: the newest facts of the journal are the example values.
    expect(events.map((event) => event.event_type)).toEqual([...Array(7).fill("goal.created"), ...Array(7).fill("goal_measurement.created")]);
    expect(events.at(-1)).toMatchObject({ goal_id: goals.at(-1)!.id, payload: { after: { value: "1200", source: "example" } } });
  });

  it("completes the start of the account in the same transaction; a setup completed before stays as it is (LFS-220)", async () => {
    const fresh = fixture();
    await fresh.service.apply(actor, options);
    expect(fresh.starts).toEqual([`${actor.userId}:1`]);
    const completed = fixture(0, true);
    expect(await completed.service.apply(actor, options)).toEqual({ version: 1, created_goals: 7, created_measurements: 7 });
    expect(completed.starts).toHaveLength(1);
  });

  it("never adds a second set next to existing examples and writes nothing", async () => {
    const { service, goals, measurements, events, starts } = fixture(3);
    await expect(service.apply(actor, options)).rejects.toBeInstanceOf(ConflictError);
    expect([goals, measurements, events, starts]).toEqual([[], [], [], []]);
  });

  it("reports a key conflict and rejects a missing command context before any work", async () => {
    const conflicting = fixture();
    vi.mocked(conflicting.unit.run).mockResolvedValueOnce({ kind: "conflict" });
    await expect(conflicting.service.apply(actor, options)).rejects.toBeInstanceOf(ConflictError);
    const { service, unit } = fixture();
    for (const value of [{}, { idempotencyKey: "starter-1", source: "starter" }, { idempotencyKey: "bad key", source: "web" }]) {
      await expect(service.apply(actor, value)).rejects.toBeInstanceOf(InvalidInputError);
      await expect(service.remove(actor, value)).rejects.toBeInstanceOf(InvalidInputError);
    }
    expect(unit.run).not.toHaveBeenCalled();
  });
});

describe("«Удалить все примеры»", () => {
  it("deletes only the goals still labelled as examples and reports their number", async () => {
    const { service, transaction, commands, events } = fixture(6);
    expect(await service.remove(actor, options)).toEqual({ deleted_goals: 6 });
    expect(transaction.examples.deleteExamples).toHaveBeenCalledExactlyOnceWith(actor);
    expect(commands[0]).toMatchObject({ operation: "starter_pack.remove", eventSource: "web" });
    expect(events).toEqual([]);
    expect(await service.remove(actor, { ...options, idempotencyKey: "starter-2" })).toEqual({ deleted_goals: 0 });
  });
});
