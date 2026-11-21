import { eq, sql } from "drizzle-orm";
import { goalCommandOptionsSchema } from "@lifeos/contracts";
import type { StarterPackUnitOfWork } from "@lifeos/domain";
import type { LifeosDatabase } from "./client.ts";
import { createActivityEventWriter } from "./activity-event-writer.ts";
import { commandFingerprint, findGoalDeletionReceipt, findOnboardingReceipt, lockCommandKey, lockStarterPack } from "./command-idempotency.ts";
import { ownedBy } from "./ownership.ts";
import { createGoalMeasurementsRepository } from "./repositories/goal-measurements.ts";
import { createGoalsRepository } from "./repositories/goals.ts";
import { createOnboardingStateRepository } from "./repositories/onboarding.ts";
import { createStarterPackRepository } from "./repositories/starter-pack.ts";
import { goalCommandReceipts } from "./schema/activity-events.ts";
import { starterPackReceipts } from "./schema/starter-pack-receipts.ts";

/**
 * Example commands (LFS-218): loading the example and «Удалить все примеры». Goals, measurements, audit facts and the
 * receipt share one transaction; a failure leaves no part of the set. The owner/key lock and all receipt tables keep one
 * key namespace with the other goal commands; the per-owner lock serializes loads with other keys.
 */
export function createStarterPackUnitOfWork(database: LifeosDatabase): StarterPackUnitOfWork {
  return {
    async run(actor, command, operation) {
      if (!goalCommandOptionsSchema.safeParse({ idempotencyKey: command.idempotencyKey, source: command.source }).success) throw new Error("Invalid command context.");
      const hash = commandFingerprint(command);
      return database.transaction(async (transaction) => {
        await lockCommandKey(transaction, actor, command.idempotencyKey);
        const [receipt] = await transaction.select().from(starterPackReceipts)
          .where(ownedBy(starterPackReceipts.userId, actor, eq(starterPackReceipts.idempotencyKey, command.idempotencyKey))).limit(1);
        if (receipt) return receipt.requestHash === hash
          ? { kind: "success", result: { goals: receipt.goals, measurements: receipt.measurements } }
          : { kind: "conflict" };
        const [goalReceipt] = await transaction.select({ key: goalCommandReceipts.idempotencyKey }).from(goalCommandReceipts)
          .where(ownedBy(goalCommandReceipts.userId, actor, eq(goalCommandReceipts.idempotencyKey, command.idempotencyKey))).limit(1);
        if (goalReceipt || await findGoalDeletionReceipt(transaction, actor, command.idempotencyKey)
          || await findOnboardingReceipt(transaction, actor, command.idempotencyKey)) return { kind: "conflict" };
        await lockStarterPack(transaction, actor);
        const result = await operation({
          goals: createGoalsRepository(transaction, { lockRows: true }),
          measurements: createGoalMeasurementsRepository(transaction),
          examples: createStarterPackRepository(transaction),
          events: createActivityEventWriter(transaction, actor, { idempotencyKey: command.idempotencyKey, source: command.eventSource }),
          onboarding: createOnboardingStateRepository(transaction),
        });
        for (const value of [result.goals, result.measurements]) if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid starter pack result.");
        await transaction.insert(starterPackReceipts).values({ userId: actor.userId, idempotencyKey: command.idempotencyKey, requestHash: hash,
          operation: command.operation, goals: result.goals, measurements: result.measurements, createdAt: sql`clock_timestamp()` });
        return { kind: "success", result };
      }, { isolationLevel: "read committed" });
    },
  };
}
