import { randomUUID } from "node:crypto";
import { createDemoPayload } from "@lifeos/contracts";
import { EnvironmentConfigurationError } from "@lifeos/config/env";
import { readWorkerConfiguration } from "./configuration.ts";
import { DEMO_POLICY, DEMO_QUEUE } from "./jobs/demo-ping.ts";
import type { DemoMode } from "./jobs/demo-ping.ts";
import { writeWorkerLog } from "./logging.ts";
import { createQueueClient, ensureDemoQueue } from "./queue.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !["--fail-once", "--always-fail"].includes(args[0]))) {
    throw new Error("Use worker:ping with no arguments, --fail-once or --always-fail.");
  }
  const mode: DemoMode = args[0] === "--fail-once" ? "fail-once" : args[0] === "--always-fail" ? "always-fail" : "ok";
  const requestId = randomUUID();
  const payload = createDemoPayload(mode, { request_id: requestId, correlation_id: requestId });
  const boss = createQueueClient(readWorkerConfiguration(process.env), writeWorkerLog, "producer");
  try {
    await boss.start();
    await ensureDemoQueue(boss);
    const id = await boss.send(DEMO_QUEUE, payload, DEMO_POLICY);
    if (!id) throw new Error("Demo job was not queued.");
    writeWorkerLog({ event: DEMO_QUEUE, status: "queued", job_id: id, request_id: payload.requestId, correlation_id: payload.correlationId });
  } finally {
    await boss.stop({ graceful: true, close: true, timeout: 10_000 });
  }
}

main().catch((error: unknown) => {
  writeWorkerLog({ event: "worker.error", status: "failed", code: "STARTUP_FAILED", ...(error instanceof EnvironmentConfigurationError ? { invalid_settings: error.settings } : {}) });
  process.exitCode = 1;
});
