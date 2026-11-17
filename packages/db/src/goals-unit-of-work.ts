import { eq, sql } from "drizzle-orm";
import { goalCommandOptionsSchema } from "@lifeos/contracts";
import type { GoalsUnitOfWork } from "@lifeos/domain";
import type { LifeosDatabase } from "./client.ts";
import { ownedBy } from "./ownership.ts";
import { goalCommandReceipts } from "./schema/activity-events.ts";
import { createGoalsRepository } from "./repositories/goals.ts";
import { createActivityEventWriter } from "./activity-event-writer.ts";
import { commandFingerprint, lockCommandKey } from "./command-idempotency.ts";

/** The only domain-command write boundary: business mutation, event and receipt share one transaction. */
export function createGoalsUnitOfWork(database: LifeosDatabase): GoalsUnitOfWork {
  return {
    goals: createGoalsRepository(database),
    async run(actor, command, operation) {
      if (!goalCommandOptionsSchema.safeParse({ idempotencyKey: command.idempotencyKey, source: command.source }).success) throw new Error("Invalid command context.");
      const hash = commandFingerprint(command);
      return database.transaction(async (transaction) => {
        // A transaction-scoped key lock also covers no-op commands. Hash collisions merely serialize callers.
        await lockCommandKey(transaction, actor, command.idempotencyKey);
        const repository = createGoalsRepository(transaction, { lockRows: true });
        const [receipt] = await transaction.select().from(goalCommandReceipts)
          .where(ownedBy(goalCommandReceipts.userId, actor, eq(goalCommandReceipts.idempotencyKey, command.idempotencyKey))).limit(1);
        if (receipt) {
          if (receipt.requestHash !== hash || receipt.resourceType !== "goal") return { kind: "conflict" };
          const goal = await repository.find(actor, receipt.goalId);
          return goal ? { kind: "success", goal } : { kind: "not_found" };
        }
        const goal = await operation({ goals: repository, events: createActivityEventWriter(transaction, actor, {
          idempotencyKey: command.idempotencyKey, source: command.source,
        }) });
        if (goal.user_id !== actor.userId) throw new Error("Invalid command owner.");
        await transaction.insert(goalCommandReceipts).values({ userId: actor.userId, idempotencyKey: command.idempotencyKey,
          requestHash: hash, operation: command.operation, source: command.source, goalId: goal.id, domainKey: goal.domain_key,
          resourceType: "goal", targetId: goal.id, createdAt: sql`clock_timestamp()` });
        return { kind: "success", goal };
      }, { isolationLevel: "read committed" });
    },
  };
}
