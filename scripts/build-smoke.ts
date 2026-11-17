import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { apiFailureSchema, currentUserResponseSchema, healthResponseSchema, userPreferencesResponseSchema } from "../packages/contracts/dist/index.js";
import { LIFE_DOMAINS } from "../packages/domain/dist/index.js";

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
  // Synthetic, unreachable services: guests must be turned away without touching the database or SMTP.
  const web = launch(["scripts/run-next.ts", "start", "--hostname", "127.0.0.1", "--port", String(port)], join(root, "apps/web"), {
    ...environment, DATABASE_URL: "postgresql://smoke@127.0.0.1:1/lifeos_smoke",
    BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"), BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
    AUTH_SIGNUP_ALLOWLIST: "", MAIL_TRANSPORT: "smtp", SMTP_URL: "smtp://127.0.0.1:1", MAIL_FROM: "smoke@lifeos.invalid",
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
    for (const path of ["/", "/telegram", "/auth/forgot-password"]) assert.equal((await fetch(base + path, { signal: AbortSignal.timeout(5_000) })).status, 200);
    stage = "production LifeOS sphere routes";
    const home = await (await fetch(base, { signal: AbortSignal.timeout(5_000) })).text();
    for (const domain of LIFE_DOMAINS) {
      assert(home.includes(`href="${domain.url}"`));
      const page = await fetch(base + domain.url, { signal: AbortSignal.timeout(5_000) });
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.equal(html.match(/<h1\b[^>]*>(.*?)<\/h1>/)?.[1], domain.name.ru);
      assert(html.includes(domain.description.ru));
      assert(html.includes("Прогресс строится по вашим измерениям."));
      assert(html.includes("Специализированный модуль появится позже"));
      assert(html.includes(`href="/goals?domain_key=${domain.key}"`));
      assert(html.includes(`href="/goals/new?domain_key=${domain.key}"`));
    }
    for (const path of ["/domains/seventh", "/domains/Languages", "/domains/constructor", "/domains", "/domains/finance/unknown"]) {
      assert.equal((await fetch(base + path, { signal: AbortSignal.timeout(5_000) })).status, 404);
    }
    stage = "production Web auth guards";
    for (const path of ["/dashboard", "/goals", "/goals/new", "/goals/4fe63a56-7a7f-4905-bdc3-c9dff1d439dc", "/settings"]) {
      const guarded = await fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
      assert.equal(guarded.status, 307);
      assert.equal(new URL(guarded.headers.get("location") ?? "", base).pathname, "/auth/sign-in");
      assert.equal(new URL(guarded.headers.get("location") ?? "", base).searchParams.get("next"), path);
    }
    // A forged cookie passes the optimistic proxy check; the page itself must still refuse it.
    const forged = await fetch(`${base}/dashboard`, { redirect: "manual", headers: { cookie: "lifeos.session_token=forged.value" }, signal: AbortSignal.timeout(5_000) });
    const forgedBody = await forged.text();
    assert([200, 307].includes(forged.status));
    assert(!forgedBody.includes("Вы вошли как"));
    assert(forged.status === 307 || forgedBody.includes("/auth/sign-in?next=%2Fdashboard"));
    const me = await fetch(`${base}/api/v1/me`, { signal: AbortSignal.timeout(5_000) });
    assert.equal(me.status, 401);
    assert.deepEqual(currentUserResponseSchema.parse(await me.json()).errors.map((error) => error.code), ["UNAUTHORIZED"]);
    // LFS-202 preferences: guests get 401 for reads and writes, even with a forged userId in the body.
    for (const init of [{ method: "GET" }, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ timezone: "UTC", userId: "smoke" }) }]) {
      const preferences = await fetch(`${base}/api/v1/me/preferences`, { ...init, signal: AbortSignal.timeout(5_000) });
      assert.equal(preferences.status, 401);
      assert.deepEqual(userPreferencesResponseSchema.parse(await preferences.json()).errors.map((error) => error.code), ["UNAUTHORIZED"]);
    }
    stage = "production goals API auth guards";
    const resourceId = "4fe63a56-7a7f-4905-bdc3-c9dff1d439dc";
    for (const [method, path] of [["GET", "/api/v1/goals"], ["POST", "/api/v1/goals"],
      ["GET", `/api/v1/goals/${resourceId}`], ["PATCH", `/api/v1/goals/${resourceId}`],
      ["GET", `/api/v1/goals/${resourceId}/measurements`], ["POST", `/api/v1/goals/${resourceId}/measurements`],
      ["PATCH", `/api/v1/goal-measurements/${resourceId}`], ["DELETE", `/api/v1/goal-measurements/${resourceId}`]]) {
      const denied = await fetch(base + path, { method, signal: AbortSignal.timeout(5_000) });
      assert.equal(denied.status, 401);
      assert.equal(denied.headers.get("cache-control"), "no-store");
      assert.deepEqual(apiFailureSchema.parse(await denied.json()).errors.map((error) => error.code), ["UNAUTHORIZED"]);
    }
    assert.equal((await fetch(`${base}/api/v1/goals/${resourceId}`, { method: "DELETE", signal: AbortSignal.timeout(5_000) })).status, 405);
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
  console.log("Build smoke passed: production Web routes/health, six LifeOS spheres and unknown-key 404, auth guards and compiled worker startup.");
}

main().catch(() => {
  // Never dump captured server output, payloads, credentials or upstream exception details.
  console.error(`Build smoke failed during ${stage}.`);
  process.exitCode = 1;
});
