import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { healthResponseSchema } from "../packages/contracts/dist/index.js";

type CapturedProcess = { child: ChildProcess; output: string; exitCode?: number | null; closed: Promise<number | null> };
const root = fileURLToPath(new URL("../", import.meta.url));
let stage = "built artifacts";

function launch(args: string[], cwd: string, environment: NodeJS.ProcessEnv): CapturedProcess {
  const child = spawn(process.execPath, args, { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const completion = Promise.withResolvers<number | null>();
  const result: CapturedProcess = { child, output: "", closed: completion.promise };
  const capture = (value: Buffer) => { result.output = (result.output + value.toString()).slice(-65_536); };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  child.once("error", () => { result.exitCode = 1; completion.resolve(1); });
  child.once("close", (code) => { result.exitCode = code; completion.resolve(code); });
  return result;
}

async function stop(running: CapturedProcess): Promise<void> {
  if (running.exitCode !== undefined) return;
  running.child.kill("SIGTERM");
  const closed = await Promise.race([running.closed.then(() => true), delay(5_000, false, { ref: false })]);
  if (!closed) { running.child.kill("SIGKILL"); await running.closed; }
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function main(): Promise<void> {
  await Promise.all(["apps/web/.next/BUILD_ID", "apps/worker/dist/index.js"].map((path) => access(join(root, path))));
  const environment: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" };
  delete environment.NEXT_PHASE;
  delete environment.TEST_DATABASE_URL;
  stage = "production Web health";
  const port = await unusedPort();
  const web = launch(["scripts/run-next.ts", "start", "--hostname", "127.0.0.1", "--port", String(port)], join(root, "apps/web"), {
    ...environment, DATABASE_URL: "postgresql://smoke@127.0.0.1:1/lifeos_smoke",
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    const correlation = "af347ed1-1e17-4bee-8305-579207023b03";
    const deadline = Date.now() + 20_000;
    let response: Response | undefined;
    while (Date.now() < deadline) {
      assert.equal(web.exitCode, undefined);
      try {
        response = await fetch(`${base}/api/health`, { headers: { "X-Correlation-ID": correlation }, signal: AbortSignal.timeout(1_000) });
        break;
      } catch { await delay(100); }
    }
    assert(response);
    assert.equal(response.status, 200);
    const body = healthResponseSchema.parse(await response.json());
    assert(body.data && body.data.status === "ok");
    assert.equal(body.meta.correlation_id, correlation);
    assert.equal(response.headers.get("x-request-id"), body.meta.request_id);
    assert.equal(response.headers.get("x-correlation-id"), correlation);
    assert.equal(response.headers.get("cache-control"), "no-store");
    for (const path of ["/", "/telegram"]) assert.equal((await fetch(base + path, { signal: AbortSignal.timeout(5_000) })).status, 200);
  } finally { await stop(web); }

  stage = "compiled worker startup";
  const worker = launch(["apps/worker/dist/index.js"], root, { ...environment, DATABASE_URL: "invalid-smoke-configuration" });
  try {
    const code = await Promise.race([
      worker.closed,
      delay(10_000, undefined, { ref: false }).then(() => { throw new Error("Worker startup timed out."); }),
    ]);
    assert.equal(code, 1);
    const event = JSON.parse(worker.output.trim()) as { event?: unknown; code?: unknown; invalid_settings?: unknown };
    assert.equal(event.event, "worker.error");
    assert.equal(event.code, "STARTUP_FAILED");
    assert.deepEqual(event.invalid_settings, ["DATABASE_URL"]);
    assert(!worker.output.includes("invalid-smoke-configuration"));
  } finally { await stop(worker); }
  console.log("Build smoke passed: production Web routes/health and compiled worker startup.");
}

main().catch(() => {
  // Never dump captured server output, payloads, credentials or upstream exception details.
  console.error(`Build smoke failed during ${stage}.`);
  process.exitCode = 1;
});
