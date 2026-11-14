import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it.each([undefined, "postgresql://fixture:do-not-log@127.0.0.1:1/lifeos"])("test migration CLI rejects missing/application target %# without fallback", (testUrl) => {
  const environment: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: "postgresql://fixture:do-not-log@127.0.0.1:1/lifeos" };
  if (testUrl === undefined) delete environment.TEST_DATABASE_URL;
  else environment.TEST_DATABASE_URL = testUrl;
  const result = spawnSync(process.execPath, ["scripts/migrate-test.ts"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)), env: environment, encoding: "utf8", timeout: 10_000, windowsHide: true,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("TEST_DATABASE_URL");
  expect(result.stdout + result.stderr).not.toMatch(/do-not-log|applied successfully|ECONNREFUSED/);
});
