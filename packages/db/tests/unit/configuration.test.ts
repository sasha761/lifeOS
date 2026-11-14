import { describe, expect, it } from "vitest";
import { DatabaseConfigurationError, databaseErrorMessage, parseDatabaseUrl, readTestDatabaseUrl } from "../../src/configuration.ts";

describe("database connection configuration", () => {
  it("accepts PostgreSQL URLs without reading global environment", () => {
    expect(parseDatabaseUrl("postgresql://fixture:example@127.0.0.1:55432/lifeos")).toBe("postgresql://fixture:example@127.0.0.1:55432/lifeos");
  });

  it.each([undefined, null, 42, "", "not-a-url", "https://fixture:do-not-log@localhost/lifeos", "postgresql://localhost/"])(
    "rejects invalid configuration case %# without echoing its input",
    (value) => {
      try {
        parseDatabaseUrl(value);
        throw new Error("Expected configuration rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseConfigurationError);
        expect(databaseErrorMessage(error)).not.toContain("do-not-log");
      }
    },
  );

  it("accepts an explicitly separate test database", () => {
    const test = "postgresql://fixture:example@127.0.0.1:55433/lifeos_test";
    expect(readTestDatabaseUrl({ DATABASE_URL: "postgresql://fixture:example@127.0.0.1:55432/lifeos", TEST_DATABASE_URL: test })).toBe(test);
  });

  it("refuses an application database as the test target", () => {
    expect(() => readTestDatabaseUrl({ TEST_DATABASE_URL: "postgresql://localhost/lifeos" })).toThrow(DatabaseConfigurationError);
  });

  it("refuses a shared application/test target, including localhost aliases", () => {
    expect(() => readTestDatabaseUrl({
      DATABASE_URL: "postgres://fixture:example@localhost/lifeos_test",
      TEST_DATABASE_URL: "postgresql://fixture:other@127.0.0.1:5432/lifeos_test",
    })).toThrow("must be different");
  });

  it("refuses missing test configuration instead of falling back to DATABASE_URL", () => {
    expect(() => readTestDatabaseUrl({ DATABASE_URL: "postgresql://localhost/lifeos" })).toThrow("TEST_DATABASE_URL");
  });

  it("formats connection errors without raw messages or credentials", () => {
    const error = Object.assign(new Error("postgresql://fixture:do-not-log@localhost/lifeos"), { code: "ECONNREFUSED" });
    expect(databaseErrorMessage(error)).toBe("Database operation failed (ECONNREFUSED).");
    expect(databaseErrorMessage(new Error("do-not-log"))).not.toContain("do-not-log");
  });
});
