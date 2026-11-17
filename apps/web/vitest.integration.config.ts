import { defineConfig } from "vitest/config";

// Real PostgreSQL (TEST_DATABASE_URL only) and the real Better Auth instance; see tests/integration.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
