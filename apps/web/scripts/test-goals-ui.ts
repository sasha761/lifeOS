import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer as createProxyServer, request as proxyRequest } from "node:http";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { readTestDatabaseUrl } from "../../../packages/db/dist/index.js";
import { createAuthHarness } from "../tests/integration/support/auth-harness.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const serve = process.argv.includes("--serve");
let stage = "isolated test setup";
async function freePort(): Promise<number> {
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); return address.port;
}
async function main() {
  await access(join(root, "apps/web/.next/BUILD_ID"));
  const secret = randomBytes(32).toString("base64url");
  const harness = await createAuthHarness({ suite: "lfs208_browser", users: ["owner", "other", "empty"], secret });
  let web: ReturnType<typeof spawn> | undefined;
  let manualProxy: ReturnType<typeof createProxyServer> | undefined;
  try {
    const owner = await harness.signUp("owner"); const other = await harness.signUp("other"); const empty = await harness.signUp("empty");
    await harness.database.pool.query(`UPDATE "user" SET timezone='Europe/Oslo',locale='en-GB' WHERE id=$1`, [owner.userId]);
    const connection = new URL(readTestDatabaseUrl(process.env)); connection.searchParams.set("options", `-csearch_path=${harness.schemaName}`);
    const port = await freePort(); const base = `http://127.0.0.1:${port}`;
    const environment: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: connection.toString(), NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
      BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: base, AUTH_SIGNUP_ALLOWLIST: "",
      MAIL_TRANSPORT: "smtp", SMTP_URL: "smtp://127.0.0.1:1", MAIL_FROM: "fixture@lifeos.test",
      LFS208_E2E_BASE_URL: base, LFS208_E2E_OWNER_COOKIE: owner.cookie, LFS208_E2E_OTHER_COOKIE: other.cookie, LFS208_E2E_EMPTY_COOKIE: empty.cookie };
    stage = "production test server";
    web = spawn(process.execPath, ["scripts/run-next.ts", "start", "--port", String(port)], { cwd: join(root, "apps/web"), env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const output: string[] = [];
    web.stdout?.on("data", (data: Buffer) => { output.push(data.toString()); if (output.length > 50) output.shift(); });
    web.stderr?.on("data", (data: Buffer) => { output.push(data.toString()); if (output.length > 50) output.shift(); });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (web.exitCode !== null) throw new Error("Test server stopped.");
      try { ready = (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) })).ok; } catch { /* startup */ }
      if (ready) break; await delay(100);
    }
    assert(ready);
    if (serve) {
      const headers = { cookie: owner.cookie, "content-type": "application/json", "idempotency-key": randomBytes(16).toString("hex") };
      const created = await fetch(`${base}/api/v1/goals`, { method: "POST", headers, body: JSON.stringify({ title: "Накопить 50 000 NOK — ручная проверка", domain_key: "finance", baseline: "0", target: "50000", unit: "NOK", direction: "increase" }) });
      assert(created.ok);
      const goalId = ((await created.json()) as { data: { goal: { id: string } } }).data.goal.id;
      const measured = await fetch(`${base}/api/v1/goals/${goalId}/measurements`, { method: "POST", headers: { ...headers, "idempotency-key": randomBytes(16).toString("hex") },
        body: JSON.stringify({ value: "12000", measured_at: new Date().toISOString(), source: "manual", note: "Тестовые данные; отдельная схема PostgreSQL." }) });
      assert(measured.ok);
      // Loopback-only QA proxy uses the disposable session without touching a user's browser cookies.
      const manualPort = await freePort();
      manualProxy = createProxyServer((incoming, outgoing) => {
        const upstream = proxyRequest(`${base}${incoming.url ?? "/"}`, { method: incoming.method,
          headers: { ...incoming.headers, host: new URL(base).host, origin: base, cookie: owner.cookie } }, (response) => {
          const headers = { ...response.headers }; delete headers["set-cookie"];
          outgoing.writeHead(response.statusCode ?? 502, headers); response.pipe(outgoing);
        });
        upstream.on("error", () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
        incoming.pipe(upstream);
      });
      manualProxy.listen(manualPort, "127.0.0.1"); await once(manualProxy, "listening");
      const manualBase = `http://127.0.0.1:${manualPort}`;
      await mkdir(join(root, ".cache/lfs208"), { recursive: true });
      const stopFile = join(root, ".cache/lfs208/stop-manual");
      await rm(stopFile, { force: true });
      await writeFile(join(root, ".cache/lfs208/manual-runtime.json"), JSON.stringify({ base: manualBase, path: `/goals/${goalId}` }));
      console.log(`Isolated UI fixture ready at ${manualBase}/goals/${goalId}. Stop via .cache/lfs208/stop-manual.`);
      while (!existsSync(stopFile)) await delay(500);
      await rm(join(root, ".cache/lfs208/manual-runtime.json"), { force: true });
    } else {
      stage = "Playwright desktop/mobile";
      const tests = spawn(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", "apps/web/playwright.config.ts"], { cwd: root, env: environment, windowsHide: true, stdio: "inherit" });
      const [exitCode] = await once(tests, "exit") as [number | null];
      assert.equal(exitCode, 0); console.log("Goals UI Playwright PASS; isolated schema will be cleaned.");
    }
  } finally {
    if (manualProxy) await new Promise<void>((resolve) => manualProxy!.close(() => resolve()));
    if (web && web.exitCode === null) { const stopped = once(web, "exit"); web.kill("SIGTERM"); await stopped; }
    await harness.close();
  }
}
main().catch(() => { console.error(`Goals UI verification failed during ${stage}.`); process.exitCode = 1; });
