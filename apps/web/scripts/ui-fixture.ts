import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { readTestDatabaseUrl } from "../../../packages/db/dist/index.js";
import { createAuthHarness } from "../tests/integration/support/auth-harness.ts";

/*
 * Isolated browser fixture shared by `pnpm test:ui` (LFS-208) and `pnpm ui:shots` (LFS-212): a fresh schema in the
 * test PostgreSQL, three Better Auth users with real sessions and the production build of the web app on a free
 * loopback port. Nothing touches the main database or the user's browser cookies.
 */
export const root = fileURLToPath(new URL("../../../", import.meta.url));

export async function freePort(): Promise<number> {
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); return address.port;
}

export type UiFixture = {
  base: string;
  cookies: { owner: string; other: string; empty: string };
  /** Environment of the server, including LFS208_E2E_* variables for Playwright. */
  environment: NodeJS.ProcessEnv;
  stop(): Promise<void>;
};

/** Starts the fixture; `onStage` names the current step for a safe failure message without secrets. */
export async function startUiFixture({ suite, ownerLocale = "en-GB", onStage = () => undefined }: { suite: string; ownerLocale?: string; onStage?: (stage: string) => void }): Promise<UiFixture> {
  onStage("isolated test setup");
  await access(join(root, "apps/web/.next/BUILD_ID"));
  const secret = randomBytes(32).toString("base64url");
  const harness = await createAuthHarness({ suite, users: ["owner", "other", "empty"], secret });
  let web: ReturnType<typeof spawn> | undefined;
  const stop = async () => {
    if (web && web.exitCode === null) { const stopped = once(web, "exit"); web.kill("SIGTERM"); await stopped; }
    await harness.close();
  };
  try {
    const owner = await harness.signUp("owner"); const other = await harness.signUp("other"); const empty = await harness.signUp("empty");
    await harness.database.pool.query(`UPDATE "user" SET timezone='Europe/Oslo',locale=$2 WHERE id=$1`, [owner.userId, ownerLocale]);
    const connection = new URL(readTestDatabaseUrl(process.env)); connection.searchParams.set("options", `-csearch_path=${harness.schemaName}`);
    const port = await freePort(); const base = `http://127.0.0.1:${port}`;
    const environment: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: connection.toString(), NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
      BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: base, AUTH_SIGNUP_ALLOWLIST: "",
      MAIL_TRANSPORT: "smtp", SMTP_URL: "smtp://127.0.0.1:1", MAIL_FROM: "fixture@lifeos.test",
      LFS208_E2E_BASE_URL: base, LFS208_E2E_OWNER_COOKIE: owner.cookie, LFS208_E2E_OTHER_COOKIE: other.cookie, LFS208_E2E_EMPTY_COOKIE: empty.cookie };
    onStage("production test server");
    web = spawn(process.execPath, ["scripts/run-next.ts", "start", "--port", String(port)], { cwd: join(root, "apps/web"), env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    // Drain server output so the pipes never block; it is not printed (it may contain request details).
    web.stdout?.resume(); web.stderr?.resume();
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (web.exitCode !== null) throw new Error("Test server stopped.");
      try { ready = (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) })).ok; } catch { /* startup */ }
      if (ready) break; await delay(100);
    }
    assert(ready);
    return { base, cookies: { owner: owner.cookie, other: other.cookie, empty: empty.cookie }, environment, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** POST/PATCH through the real API as a fixture user; every write carries its own idempotency key. */
export async function apiWrite<T>(base: string, cookie: string, path: string, body: unknown, method: "POST" | "PATCH" = "POST"): Promise<T> {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(body) });
  assert(response.ok, `${method} ${path} → ${response.status}`);
  return ((await response.json()) as { data: T }).data;
}
