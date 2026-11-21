import { eq, sql } from "drizzle-orm";
import { goalCommandOptionsSchema } from "@lifeos/contracts";
import type { GoalMeasurementsUnitOfWork } from "@lifeos/domain";
import type { LifeosDatabase } from "./client.ts";
import { createActivityEventWriter } from "./activity-event-writer.ts";
import { commandFingerprint, findGoalDeletionReceipt, findStarterPackReceipt, lockCommandKey } from "./command-idempotency.ts";
import { ownedBy } from "./ownership.ts";
import { createGoalsRepository } from "./repositories/goals.ts";
import { createGoalMeasurementsRepository } from "./repositories/goal-measurements.ts";
import { goalCommandReceipts } from "./schema/activity-events.ts";
export function createGoalMeasurementsUnitOfWork(database: LifeosDatabase): GoalMeasurementsUnitOfWork {
  return {
    goals: createGoalsRepository(database), measurements: createGoalMeasurementsRepository(database),
    async run(actor, command, operation) {
      if (!goalCommandOptionsSchema.safeParse({ idempotencyKey: command.idempotencyKey, source: command.source }).success) throw new Error("Invalid command context.");
      const hash = commandFingerprint(command);
      return database.transaction(async (transaction) => {
        await lockCommandKey(transaction, actor, command.idempotencyKey);
        if (await findGoalDeletionReceipt(transaction, actor, command.idempotencyKey)
          || await findStarterPackReceipt(transaction, actor, command.idempotencyKey)) return { kind: "conflict" };
        const goals = createGoalsRepository(transaction, { lockRows: true });
        const readMeasurements = createGoalMeasurementsRepository(transaction);
        const [receipt] = await transaction.select().from(goalCommandReceipts)
          .where(ownedBy(goalCommandReceipts.userId, actor, eq(goalCommandReceipts.idempotencyKey, command.idempotencyKey))).limit(1);
        if (receipt) {
          if (receipt.requestHash !== hash || receipt.resourceType !== "measurement" || !receipt.targetId) return { kind: "conflict" };
          if (command.operation === "measurement.delete") return { kind: "success", result: { id: receipt.targetId, goal_id: receipt.goalId, user_id: actor.userId, deleted: true } };
          const measurement = await readMeasurements.find(actor, receipt.targetId);
          return measurement ? { kind: "success", result: measurement } : { kind: "not_found" };
        }
        // Parent always precedes child in lock order. The callback re-reads a possibly removed child.
        const parentId = command.operation === "measurement.create" ? command.targetId : (await readMeasurements.find(actor, command.targetId))?.goal_id;
        if (!parentId) return { kind: "not_found" };
        const goal = await goals.find(actor, parentId);
        if (!goal) return { kind: "not_found" };
        const result = await operation({ goals, measurements: createGoalMeasurementsRepository(transaction, { lockRows: true }),
          events: createActivityEventWriter(transaction, actor, { idempotencyKey: command.idempotencyKey, source: command.source }) });
        if (result.user_id !== actor.userId || result.goal_id !== goal.id) throw new Error("Invalid measurement command owner.");
        await transaction.insert(goalCommandReceipts).values({ userId: actor.userId, idempotencyKey: command.idempotencyKey, requestHash: hash,
          operation: command.operation, source: command.source, goalId: goal.id, domainKey: goal.domain_key,
          resourceType: "measurement", targetId: result.id, createdAt: sql`clock_timestamp()` });
        return { kind: "success", result };
      }, { isolationLevel: "read committed" });
    },
  };
}
