import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer as createProxyServer, request as proxyRequest } from "node:http";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { apiWrite, freePort, root, startUiFixture } from "./ui-fixture.ts";
import type { UiFixture } from "./ui-fixture.ts";

const serve = process.argv.includes("--serve");
let stage = "isolated test setup";
async function main() {
  let fixture: UiFixture | undefined;
  let manualProxy: ReturnType<typeof createProxyServer> | undefined;
  try {
    fixture = await startUiFixture({ suite: "lfs208_browser", onStage: (value) => { stage = value; } });
    const { base, cookies } = fixture;
    if (serve) {
      const created = await apiWrite<{ goal: { id: string } }>(base, cookies.owner, "/api/v1/goals", { title: "Накопить 50 000 NOK — ручная проверка", domain_key: "finance", baseline: "0", target: "50000", unit: "NOK", direction: "increase" });
      const goalId = created.goal.id;
      await apiWrite(base, cookies.owner, `/api/v1/goals/${goalId}/measurements`, { value: "12000", measured_at: new Date().toISOString(), source: "manual", note: "Тестовые данные; отдельная схема PostgreSQL." });
      // Loopback-only QA proxy uses the disposable session without touching a user's browser cookies.
      const manualPort = await freePort();
      manualProxy = createProxyServer((incoming, outgoing) => {
        const upstream = proxyRequest(`${base}${incoming.url ?? "/"}`, { method: incoming.method,
          headers: { ...incoming.headers, host: new URL(base).host, origin: base, cookie: cookies.owner } }, (response) => {
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
      const tests = spawn(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", "apps/web/playwright.config.ts"], { cwd: root, env: fixture.environment, windowsHide: true, stdio: "inherit" });
      const [exitCode] = await once(tests, "exit") as [number | null];
      assert.equal(exitCode, 0); console.log("Goals UI Playwright PASS; isolated schema will be cleaned.");
    }
  } finally {
    if (manualProxy) await new Promise<void>((resolve) => manualProxy!.close(() => resolve()));
    await fixture?.stop();
  }
}
main().catch(() => { console.error(`Goals UI verification failed during ${stage}.`); process.exitCode = 1; });
