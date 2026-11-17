import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e", fullyParallel: false, workers: 1, retries: 0, timeout: 45_000,
  outputDir: "../../.cache/lfs208/playwright", reporter: "list",
  use: { baseURL: process.env.LFS208_E2E_BASE_URL, browserName: "chromium", channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === "win32" ? "msedge" : undefined),
    trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } }],
});
