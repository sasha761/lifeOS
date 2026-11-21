import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Actor } from "@lifeos/domain";
import type { LifeosTransaction } from "./client.ts";
import { ownedBy } from "./ownership.ts";
import { goalDeletionReceipts } from "./schema/goal-deletion-receipts.ts";
import { onboardingReceipts } from "./schema/onboarding.ts";
import { starterPackReceipts } from "./schema/starter-pack-receipts.ts";

/** Called while holding the shared owner/key advisory lock, including by legacy goal/measurement commands. */
export async function findGoalDeletionReceipt(transaction: LifeosTransaction, actor: Actor, key: string) {
  const [receipt] = await transaction.select().from(goalDeletionReceipts)
    .where(ownedBy(goalDeletionReceipts.userId, actor, eq(goalDeletionReceipts.idempotencyKey, key))).limit(1);
  return receipt;
}
/** The example commands (LFS-218) share the owner/key namespace: a goal command must not reuse their key. */
export async function findStarterPackReceipt(transaction: LifeosTransaction, actor: Actor, key: string) {
  const [receipt] = await transaction.select().from(starterPackReceipts)
    .where(ownedBy(starterPackReceipts.userId, actor, eq(starterPackReceipts.idempotencyKey, key))).limit(1);
  return receipt;
}
/** «Создать N целей» of the onboarding wizard (LFS-219) shares the owner/key namespace too. */
export async function findOnboardingReceipt(transaction: LifeosTransaction, actor: Actor, key: string) {
  const [receipt] = await transaction.select().from(onboardingReceipts)
    .where(ownedBy(onboardingReceipts.userId, actor, eq(onboardingReceipts.idempotencyKey, key))).limit(1);
  return receipt;
}
/** One lock per owner for completing the wizard: two completions (other keys, other tabs) run one after the other. */
export async function lockOnboarding(transaction: LifeosTransaction, actor: Actor): Promise<void> {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["onboarding", actor.userId])}, 0))`);
}
/** One lock per owner for the example: two loads (other keys, other tabs) never produce two sets. */
export async function lockStarterPack(transaction: LifeosTransaction, actor: Actor): Promise<void> {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["starter_pack", actor.userId])}, 0))`);
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
