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
  /**
   * `example*`: own accounts for the example (LFS-218), `onboarding*`: fresh accounts for the wizard (LFS-219), `start*`
   * and `startExample*`: fresh accounts for the first-visit popup (LFS-220); one per Playwright project, so their data never collide.
   */
  cookies: { owner: string; other: string; empty: string; exampleDesktop: string; exampleMobile: string; onboardingDesktop: string; onboardingMobile: string;
    startDesktop: string; startMobile: string; startExampleDesktop: string; startExampleMobile: string };
  /** Environment of the server, including LFS208_E2E_* variables for Playwright. */
  environment: NodeJS.ProcessEnv;
  stop(): Promise<void>;
};

/** Starts the fixture; `onStage` names the current step for a safe failure message without secrets. */
export async function startUiFixture({ suite, ownerLocale = "en-GB", onStage = () => undefined }: { suite: string; ownerLocale?: string; onStage?: (stage: string) => void }): Promise<UiFixture> {
  onStage("isolated test setup");
  await access(join(root, "apps/web/.next/BUILD_ID"));
  const secret = randomBytes(32).toString("base64url");
  const harness = await createAuthHarness({ suite, users: ["owner", "other", "empty", "example-desktop", "example-mobile", "onboarding-desktop", "onboarding-mobile",
    "start-desktop", "start-mobile", "start-example-desktop", "start-example-mobile"], secret });
  let web: ReturnType<typeof spawn> | undefined;
  const stop = async () => {
    if (web && web.exitCode === null) { const stopped = once(web, "exit"); web.kill("SIGTERM"); await stopped; }
    await harness.close();
  };
  try {
    const owner = await harness.signUp("owner"); const other = await harness.signUp("other"); const empty = await harness.signUp("empty");
    const exampleDesktop = await harness.signUp("example-desktop"); const exampleMobile = await harness.signUp("example-mobile");
    const onboardingDesktop = await harness.signUp("onboarding-desktop"); const onboardingMobile = await harness.signUp("onboarding-mobile");
    const startDesktop = await harness.signUp("start-desktop"); const startMobile = await harness.signUp("start-mobile");
    const startExampleDesktop = await harness.signUp("start-example-desktop"); const startExampleMobile = await harness.signUp("start-example-mobile");
    for (const account of [owner, exampleDesktop, exampleMobile, onboardingDesktop, onboardingMobile, startDesktop, startMobile, startExampleDesktop, startExampleMobile]) {
      await harness.database.pool.query(`UPDATE "user" SET timezone='Europe/Oslo',locale=$2 WHERE id=$1`, [account.userId, ownerLocale]);
    }
    const connection = new URL(readTestDatabaseUrl(process.env)); connection.searchParams.set("options", `-csearch_path=${harness.schemaName}`);
    const port = await freePort(); const base = `http://127.0.0.1:${port}`;
    const environment: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: connection.toString(), NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
      BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: base, AUTH_SIGNUP_ALLOWLIST: "",
      MAIL_TRANSPORT: "smtp", SMTP_URL: "smtp://127.0.0.1:1", MAIL_FROM: "fixture@lifeos.test",
      LFS208_E2E_BASE_URL: base, LFS208_E2E_OWNER_COOKIE: owner.cookie, LFS208_E2E_OTHER_COOKIE: other.cookie, LFS208_E2E_EMPTY_COOKIE: empty.cookie,
      LFS208_E2E_EXAMPLE_DESKTOP_COOKIE: exampleDesktop.cookie, LFS208_E2E_EXAMPLE_MOBILE_COOKIE: exampleMobile.cookie,
      LFS208_E2E_ONBOARDING_DESKTOP_COOKIE: onboardingDesktop.cookie, LFS208_E2E_ONBOARDING_MOBILE_COOKIE: onboardingMobile.cookie,
      LFS208_E2E_START_DESKTOP_COOKIE: startDesktop.cookie, LFS208_E2E_START_MOBILE_COOKIE: startMobile.cookie,
      LFS208_E2E_START_EXAMPLE_DESKTOP_COOKIE: startExampleDesktop.cookie, LFS208_E2E_START_EXAMPLE_MOBILE_COOKIE: startExampleMobile.cookie,
      // Disposable credentials of the fixture owner for the sign-in form (LFS-209); the user lives only in this schema.
      LFS209_E2E_OWNER_EMAIL: owner.email, LFS209_E2E_OWNER_PASSWORD: owner.password };
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
    return { base, cookies: { owner: owner.cookie, other: other.cookie, empty: empty.cookie, exampleDesktop: exampleDesktop.cookie, exampleMobile: exampleMobile.cookie,
      onboardingDesktop: onboardingDesktop.cookie, onboardingMobile: onboardingMobile.cookie, startDesktop: startDesktop.cookie, startMobile: startMobile.cookie,
      startExampleDesktop: startExampleDesktop.cookie, startExampleMobile: startExampleMobile.cookie }, environment, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** POST/PUT/PATCH through the real API as a fixture user; every write carries its own idempotency key. */
export async function apiWrite<T>(base: string, cookie: string, path: string, body: unknown, method: "POST" | "PUT" | "PATCH" = "POST"): Promise<T> {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(body) });
  assert(response.ok, `${method} ${path} → ${response.status}`);
  return ((await response.json()) as { data: T }).data;
}
