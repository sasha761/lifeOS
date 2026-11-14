import { EnvironmentConfigurationError } from "@lifeos/config/env";
import { readWorkerConfiguration } from "./configuration.ts";
import { writeWorkerLog } from "./logging.ts";
import type { WorkerLogger } from "./logging.ts";
import { createWorkerRuntime } from "./runtime.ts";
import type { WorkerRuntime } from "./runtime.ts";

export async function runWorkerProcess(log: WorkerLogger = writeWorkerLog, createRuntime: typeof createWorkerRuntime = createWorkerRuntime): Promise<void> {
  let runtime: WorkerRuntime;
  try {
    runtime = createRuntime(readWorkerConfiguration(process.env), log);
  } catch (error: unknown) {
    log({ event: "worker.error", status: "failed", code: "STARTUP_FAILED", ...(error instanceof EnvironmentConfigurationError ? { invalid_settings: error.settings } : {}) });
    process.exitCode = 1;
    return;
  }
  let shutdown: Promise<void> | undefined;
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  if (process.platform === "win32") signals.push("SIGBREAK");
  const stop = (): Promise<void> => {
    shutdown ??= (async () => {
      log({ event: "worker.stopping", status: "stopping" });
      try {
        await runtime.stop();
        log({ event: "worker.stopped", status: "stopped" });
      } catch {
        log({ event: "worker.error", status: "failed", code: "SHUTDOWN_FAILED" });
        process.exitCode = 1;
      } finally {
        for (const signal of signals) process.off(signal, onSignal);
      }
    })();
    return shutdown;
  };
  const onSignal = () => { void stop(); };
  for (const signal of signals) process.on(signal, onSignal);
  try {
    await runtime.start();
    if (!shutdown) log({ event: "worker.ready", status: "ready" });
  } catch {
    process.exitCode = 1;
    log({ event: "worker.error", status: "failed", code: "STARTUP_FAILED" });
    await stop();
  }
}
