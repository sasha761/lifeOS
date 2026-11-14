import type { Job } from "pg-boss";
import type { WorkerConfiguration } from "./configuration.ts";
import { DEMO_QUEUE, handleDemoPing } from "./jobs/demo-ping.ts";
import type { DemoResult } from "./jobs/demo-ping.ts";
import type { WorkerLogger } from "./logging.ts";
import { createQueueClient, ensureDemoQueue } from "./queue.ts";

export type WorkerRuntime = { start: () => Promise<void>; stop: () => Promise<void> };
export type DemoHandler = (job: Job<unknown>, log: WorkerLogger) => Promise<DemoResult>;

export function createWorkerRuntime(configuration: WorkerConfiguration, log: WorkerLogger, handler: DemoHandler = handleDemoPing): WorkerRuntime {
  const boss = createQueueClient(configuration, log, "worker");
  let stopping = false;
  let shutdown: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopping = true;
    shutdown ??= boss.stop({ graceful: true, close: true, timeout: 10_000 });
    return shutdown;
  };
  return {
    stop,
    async start() {
      try {
        await boss.start();
        if (stopping) return;
        await ensureDemoQueue(boss);
        if (stopping) return;
        await boss.work<unknown>(DEMO_QUEUE, { batchSize: 1, pollingIntervalSeconds: 1 }, async ([job]) => {
          if (!job) throw new Error("Missing demo.ping job.");
          return handler(job, log);
        });
      } catch (error) {
        await stop();
        throw error;
      }
    },
  };
}
