// IPC signal delivery and a controllable active handler exist only in this test fixture.
import { runWorkerProcess } from "../../src/process.ts";
import { createWorkerRuntime } from "../../src/runtime.ts";
import { handleDemoPing } from "../../src/jobs/demo-ping.ts";
import { writeWorkerLog } from "../../src/logging.ts";

let release: (() => void) | undefined;
const gate = new Promise<void>((resolve) => { release = resolve; });
process.on("message", (message: unknown) => {
  if (message === "release") release?.();
  if (message === "SIGINT" || message === "SIGTERM") process.emit(message);
});

await runWorkerProcess((event) => {
  writeWorkerLog(event);
  if (event.event === "worker.stopped" && process.connected) process.disconnect();
}, (configuration, log) => createWorkerRuntime(configuration, log, async (job, logger) => {
  if (process.env.LFS105_TEST_HOLD === "1") {
    console.log(JSON.stringify({ event: "test.active", job_id: job.id }));
    await gate;
  }
  return handleDemoPing(job, logger);
}));
