import { eq, sql } from "drizzle-orm";
import { goalCommandOptionsSchema } from "@lifeos/contracts";
import type { OnboardingUnitOfWork } from "@lifeos/domain";
import type { LifeosDatabase } from "./client.ts";
import { createActivityEventWriter } from "./activity-event-writer.ts";
import { commandFingerprint, findGoalDeletionReceipt, findStarterPackReceipt, lockCommandKey, lockOnboarding } from "./command-idempotency.ts";
import { ownedBy } from "./ownership.ts";
import { createGoalsRepository } from "./repositories/goals.ts";
import { createOnboardingProfileRepository, createOnboardingStateRepository } from "./repositories/onboarding.ts";
import { goalCommandReceipts } from "./schema/activity-events.ts";
import { onboardingReceipts } from "./schema/onboarding.ts";

/**
 * «Создать N целей» of the onboarding wizard (LFS-219): goals, audit facts, profile, state and receipt share one
 * transaction, so a failure leaves no goal behind. The owner/key lock and all receipt tables keep one key namespace with
 * the other goal commands; the per-owner lock serializes completions with other keys.
 */
export function createOnboardingUnitOfWork(database: LifeosDatabase): OnboardingUnitOfWork {
  return {
    state: createOnboardingStateRepository(database),
    async run(actor, command, operation) {
      if (!goalCommandOptionsSchema.safeParse({ idempotencyKey: command.idempotencyKey, source: command.source }).success) throw new Error("Invalid command context.");
      const hash = commandFingerprint(command);
      return database.transaction(async (transaction) => {
        await lockCommandKey(transaction, actor, command.idempotencyKey);
        const [receipt] = await transaction.select().from(onboardingReceipts)
          .where(ownedBy(onboardingReceipts.userId, actor, eq(onboardingReceipts.idempotencyKey, command.idempotencyKey))).limit(1);
        if (receipt) return receipt.requestHash === hash ? { kind: "success", result: { goals: receipt.goals } } : { kind: "conflict" };
        const [goalReceipt] = await transaction.select({ key: goalCommandReceipts.idempotencyKey }).from(goalCommandReceipts)
          .where(ownedBy(goalCommandReceipts.userId, actor, eq(goalCommandReceipts.idempotencyKey, command.idempotencyKey))).limit(1);
        if (goalReceipt || await findGoalDeletionReceipt(transaction, actor, command.idempotencyKey)
          || await findStarterPackReceipt(transaction, actor, command.idempotencyKey)) return { kind: "conflict" };
        await lockOnboarding(transaction, actor);
        const result = await operation({
          goals: createGoalsRepository(transaction, { lockRows: true }),
          events: createActivityEventWriter(transaction, actor, { idempotencyKey: command.idempotencyKey, source: command.source }),
          state: createOnboardingStateRepository(transaction),
          profile: createOnboardingProfileRepository(transaction),
        });
        if (!Number.isSafeInteger(result.goals) || result.goals < 1) throw new Error("Invalid onboarding result.");
        await transaction.insert(onboardingReceipts).values({ userId: actor.userId, idempotencyKey: command.idempotencyKey, requestHash: hash,
          goals: result.goals, createdAt: sql`clock_timestamp()` });
        return { kind: "success", result };
      }, { isolationLevel: "read committed" });
    },
  };
}
