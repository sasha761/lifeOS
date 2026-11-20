import { createGoalInputSchema, goalCommandOptionsSchema, goalValueMatchesUnit, STARTER_PACK_VERSION } from "@lifeos/contracts";
import type { Goal, GoalCommandOptions, StarterPackApplied, StarterPackRemoved } from "@lifeos/contracts";
import type { Actor } from "./actor.ts";
import { ConflictError, InvalidInputError } from "./errors.ts";
import { goalAuditSnapshot, measurementSnapshot } from "./events.ts";
import type { ActivityEventWriter } from "./events.ts";
import type { GoalMeasurementsRepository } from "./goal-measurements.ts";
import type { GoalsRepository } from "./goals.ts";
import { requireFound, requireOwned } from "./ownership.ts";

/** Note of every example measurement: it says what to do with it, it is never presented as the person's data. */
export const STARTER_PACK_NOTE = "Пример — замените своим значением или удалите";

/**
 * The example of version 1 (owner decision 2026-11-18, LFS-218): seven goals in all six spheres without deadlines and one
 * example measurement each. Repeated habits are expressed by a unit («тренировок в неделю»), as in a person's own goal.
 * Each entry passes the public creation contract; the measurement follows the same unit rules as a manual one.
 */
export const STARTER_PACK = Object.freeze([
  { goal: { domain_key: "finance", title: "Накопить 5 000 $", unit: "USD", baseline: "0", target: "5000", direction: "increase" }, example: "1200" },
  { goal: { domain_key: "languages", title: "Английский до уровня B2", unit: "custom", unit_label: "уровень (A1=1 … C2=6)", baseline: "2", target: "4", direction: "increase" }, example: "3" },
  { goal: { domain_key: "health", title: "Ходить в зал 3 раза в неделю", unit: "custom", unit_label: "тренировок в неделю", baseline: "0", target: "3", direction: "increase" }, example: "2" },
  { goal: { domain_key: "health", title: "Бокс раз в неделю", unit: "custom", unit_label: "тренировок в неделю", baseline: "0", target: "1", direction: "increase" }, example: "1" },
  { goal: { domain_key: "skills", title: "Рейтинг Lichess 1500", unit: "custom", unit_label: "рейтинг Lichess", baseline: "1000", target: "1500", direction: "increase" }, example: "1150" },
  { goal: { domain_key: "work", title: "Прочитать 6 книг по профессии", unit: "count", baseline: "0", target: "6", direction: "increase" }, example: "2" },
  { goal: { domain_key: "projects", title: "Запустить личный проект", unit: "custom", unit_label: "этапов", baseline: "0", target: "5", direction: "increase" }, example: "1" },
] as const);

/** Owner-scoped access to the example goals; called inside the command transaction, under the per-owner lock. */
export type StarterPackRepository = {
  /** Goals still labelled as examples (`origin = starter`), active and archived. */
  countExamples(actor: Actor): Promise<number>;
  /** Hard-deletes them with their measurements, history and receipts (cascade, as in LFS-216); returns what was removed. */
  deleteExamples(actor: Actor): Promise<{ goals: number; measurements: number }>;
};
export type StarterPackTransaction = {
  goals: Pick<GoalsRepository, "create">;
  measurements: Pick<GoalMeasurementsRepository, "create">;
  examples: StarterPackRepository;
  events: ActivityEventWriter;
};
/** `eventSource` stamps the audit facts the command writes: loading the example is a `starter` fact. */
export type StarterPackCommand = GoalCommandOptions & {
  operation: "starter_pack.apply" | "starter_pack.remove";
  targetId: null;
  input: { version: typeof STARTER_PACK_VERSION };
  eventSource: "starter" | GoalCommandOptions["source"];
};
export type StarterPackResult = { goals: number; measurements: number };
export type StarterPackOutcome = { kind: "success"; result: StarterPackResult } | { kind: "conflict" };
/**
 * One transaction per command: owner/key lock, per-owner lock, receipts of all goal commands (one key namespace), the
 * work and a receipt that replays the same counts for the same key.
 */
export type StarterPackUnitOfWork = {
  run(actor: Actor, command: StarterPackCommand, operation: (transaction: StarterPackTransaction) => Promise<StarterPackResult>): Promise<StarterPackOutcome>;
};
export type StarterPackService = {
  apply(actor: Actor, options: unknown): Promise<StarterPackApplied>;
  remove(actor: Actor, options: unknown): Promise<StarterPackRemoved>;
};

function commandOptions(input: unknown): GoalCommandOptions {
  const parsed = goalCommandOptionsSchema.safeParse(input);
  if (!parsed.success) throw new InvalidInputError();
  return parsed.data;
}
function owned<T extends { user_id: string }>(actor: Actor, value: T | null): T {
  const row = requireFound(value);
  requireOwned(actor, { userId: row.user_id });
  return row;
}

/**
 * Loads the example only on the person's explicit request (no sign-up hook, no bulk job) and removes it with one command.
 * Goals and measurements are written by the same repositories and audit as manual ones.
 */
export function createStarterPackService(unit: StarterPackUnitOfWork, clock: () => Date = () => new Date()): StarterPackService {
  async function execute(actor: Actor, command: StarterPackCommand, operation: (transaction: StarterPackTransaction) => Promise<StarterPackResult>) {
    const outcome = await unit.run(actor, command, operation);
    if (outcome.kind === "conflict") throw new ConflictError();
    if (outcome.kind !== "success") throw new Error("Invalid starter pack outcome.");
    return outcome.result;
  }
  return {
    async apply(actor, options) {
      const command: StarterPackCommand = { ...commandOptions(options), operation: "starter_pack.apply", targetId: null,
        input: { version: STARTER_PACK_VERSION }, eventSource: "starter" };
      const result = await execute(actor, command, async ({ goals, measurements, examples, events }) => {
        // «Пример уже в аккаунте»: a second set is never added next to the first.
        if (await examples.countExamples(actor) > 0) throw new ConflictError();
        const measuredAt = clock().toISOString();
        const created: { goal: Goal; example: string }[] = [];
        // Created in reverse, so the first entry of the set is the newest goal and fact (as on mockup 28).
        for (const entry of [...STARTER_PACK].reverse()) {
          const goal = owned(actor, await goals.create(actor, createGoalInputSchema.parse(entry.goal), { origin: "starter" }));
          if (goal.origin !== "starter") throw new Error("Example goal without its origin.");
          await events.append({ goal_id: goal.id, domain_key: goal.domain_key, target_type: "goal", target_id: goal.id, schema_version: 1,
            event_type: "goal.created", payload: { before: null, after: goalAuditSnapshot(goal) } });
          created.push({ goal, example: entry.example });
        }
        for (const { goal, example } of created) {
          if (!goalValueMatchesUnit(example, goal.unit)) throw new Error("Invalid example measurement.");
          const measurement = owned(actor, await measurements.create(actor, goal, { value: example, measured_at: measuredAt, source: "example", note: STARTER_PACK_NOTE }));
          await events.append({ goal_id: goal.id, domain_key: goal.domain_key, target_type: "goal_measurement", target_id: measurement.id, schema_version: 1,
            event_type: "goal_measurement.created", payload: { before: null, after: measurementSnapshot(measurement) } });
        }
        return { goals: created.length, measurements: created.length };
      });
      return { version: STARTER_PACK_VERSION, created_goals: result.goals, created_measurements: result.measurements };
    },
    async remove(actor, options) {
      const context = commandOptions(options);
      const command: StarterPackCommand = { ...context, operation: "starter_pack.remove", targetId: null,
        input: { version: STARTER_PACK_VERSION }, eventSource: context.source };
      // Goals the person made their own are `manual` and stay; their history goes with nothing else.
      const result = await execute(actor, command, ({ examples }) => examples.deleteExamples(actor));
      return { deleted_goals: result.goals };
    },
  };
}
