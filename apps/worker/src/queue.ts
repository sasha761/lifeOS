import { PgBoss } from "pg-boss";
import type { WorkerConfiguration } from "./configuration.ts";
import { DEMO_POLICY, DEMO_QUEUE } from "./jobs/demo-ping.ts";
import type { WorkerLogger } from "./logging.ts";

export function createQueueClient(configuration: WorkerConfiguration, log: WorkerLogger, role: "worker" | "producer"): PgBoss {
  const boss = new PgBoss({
    connectionString: configuration.connectionString, schema: configuration.schema,
    application_name: `lifeos-${role}`, max: 5, connectionTimeoutMillis: 5_000,
    schedule: false, supervise: role === "worker", openTelemetry: { enabled: false },
  });
  // Upstream errors/warnings may contain SQL, connection strings or job data.
  boss.on("error", () => log({ event: "queue.error", status: "failed", code: "DATABASE_ERROR" }));
  boss.on("warning", () => log({ event: "queue.warning", status: "warning", code: "QUEUE_WARNING" }));
  return boss;
}

export async function ensureDemoQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(DEMO_QUEUE, DEMO_POLICY);
  // createQueue leaves an existing queue unchanged; reconcile bounded defaults.
  await boss.updateQueue(DEMO_QUEUE, DEMO_POLICY);
}
