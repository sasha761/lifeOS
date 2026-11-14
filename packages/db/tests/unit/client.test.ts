import { describe, expect, it, vi } from "vitest";
import { createDatabase } from "../../src/client.ts";

describe("database client lifetime", () => {
  it("creates a lazy pool and closes without connecting", async () => {
    const onIdleError = vi.fn();
    const client = createDatabase({ connectionString: "postgresql://fixture:example@127.0.0.1:1/lifeos", onIdleError });
    try {
      expect(client.pool.totalCount).toBe(0);
      client.pool.emit("error", new Error("sensitive server details"));
      expect(onIdleError).toHaveBeenCalledExactlyOnceWith();
    } finally {
      await client.close();
    }
  });

  it("rejects invalid configuration before creating a pool", () => {
    expect(() => createDatabase({ connectionString: "https://invalid.example" })).toThrow("DATABASE_URL");
  });
});
