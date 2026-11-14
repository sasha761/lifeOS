import type { Job, QueueOptions } from "pg-boss";
import { demoPingPayloadSchema } from "@lifeos/contracts";
import type { DemoPayload } from "@lifeos/contracts";
export type { DemoMode, DemoPayload } from "@lifeos/contracts";
import type { WorkerLogger } from "../logging.ts";

export const DEMO_QUEUE = "demo.ping";
export const DEMO_POLICY = {
  retryLimit: 2, retryDelay: 1, retryBackoff: true, retryDelayMax: 10,
  expireInSeconds: 30, retentionSeconds: 86_400, deleteAfterSeconds: 86_400,
} satisfies QueueOptions;

export type DemoResult = { correlation_id: string; request_id?: string; status: "pong" };

export function parseDemoPayload(value: unknown): DemoPayload {
  const result = demoPingPayloadSchema.safeParse(value);
  if (!result.success) throw new Error("Invalid demo.ping payload.");
  return result.data;
}

export async function handleDemoPing(job: Pick<Job<unknown>, "id" | "data" | "retryCount">, log: WorkerLogger): Promise<DemoResult> {
  let payload: DemoPayload;
  try {
    payload = parseDemoPayload(job.data);
  } catch {
    log({ event: DEMO_QUEUE, status: "attempt_failed", job_id: job.id, attempt: job.retryCount + 1, code: "INVALID_PAYLOAD" });
    throw new Error("Invalid demo.ping payload.");
  }
  const context = { correlation_id: payload.correlationId, ...(payload.requestId ? { request_id: payload.requestId } : {}) };
  const fields = { job_id: job.id, ...context, attempt: job.retryCount + 1 };
  if (payload.mode === "always-fail" || (payload.mode === "fail-once" && job.retryCount === 0)) {
    log({ event: DEMO_QUEUE, status: "attempt_failed", ...fields, code: "DEMO_FAILURE" });
    throw new Error("Expected demo.ping failure.");
  }
  log({ event: DEMO_QUEUE, status: "processed", ...fields });
  return { ...context, status: "pong" };
}
