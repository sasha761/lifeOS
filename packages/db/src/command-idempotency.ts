import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Actor } from "@lifeos/domain";
import type { LifeosTransaction } from "./client.ts";
import { ownedBy } from "./ownership.ts";
import { goalDeletionReceipts } from "./schema/goal-deletion-receipts.ts";

/** Called while holding the shared owner/key advisory lock, including by legacy goal/measurement commands. */
export async function findGoalDeletionReceipt(transaction: LifeosTransaction, actor: Actor, key: string) {
  const [receipt] = await transaction.select().from(goalDeletionReceipts)
    .where(ownedBy(goalDeletionReceipts.userId, actor, eq(goalDeletionReceipts.idempotencyKey, key))).limit(1);
  return receipt;
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}
/** Byte-compatible with LFS-210, including the shared owner/key lock namespace. */
export function commandFingerprint(command: { operation: string; targetId: string | null; source: string; input: unknown }): string {
  return createHash("sha256").update(canonical({ operation: command.operation, target: command.targetId, source: command.source, input: command.input })).digest("hex");
}
export async function lockCommandKey(transaction: LifeosTransaction, actor: Actor, key: string): Promise<void> {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([actor.userId, key])}, 0))`);
}
