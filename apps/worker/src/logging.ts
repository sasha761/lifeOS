import type { RequestContext } from "@lifeos/contracts";
import type { EnvironmentConfigurationError } from "@lifeos/config/env";

export type WorkerEvent = {
  event: "worker.ready" | "worker.stopping" | "worker.stopped" | "worker.error" | "queue.error" | "queue.warning" | "demo.ping";
  status: "ready" | "stopping" | "stopped" | "failed" | "queued" | "processed" | "attempt_failed" | "warning";
  job_id?: string;
  correlation_id?: RequestContext["correlation_id"];
  request_id?: RequestContext["request_id"];
  invalid_settings?: EnvironmentConfigurationError["settings"];
  attempt?: number;
  code?: "INVALID_PAYLOAD" | "DEMO_FAILURE" | "STARTUP_FAILED" | "SHUTDOWN_FAILED" | "DATABASE_ERROR" | "QUEUE_WARNING";
};

export type WorkerLogger = (event: WorkerEvent) => void;
export const writeWorkerLog: WorkerLogger = (event) => console.log(JSON.stringify(event));
