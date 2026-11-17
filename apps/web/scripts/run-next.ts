import { existsSync } from "node:fs";
import { EnvironmentConfigurationError, readWebEnv } from "@lifeos/config/env";

const command = process.argv[2];
if (command !== "dev" && command !== "start") {
  console.error("Use the web dev or start script.");
  process.exitCode = 1;
} else {
  let valid = false;
  try {
    // Load root env without CLI flags: Next forwards execArgv to its dev child via NODE_OPTIONS.
    const envFile = new URL("../../../.env", import.meta.url);
    if (existsSync(envFile)) process.loadEnvFile(envFile);
    // Match Next CLI before validation, so start cannot accept development-only mail settings.
    Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV || (command === "dev" ? "development" : "production") });
    readWebEnv(process.env);
    valid = true;
  } catch (error: unknown) {
    console.error(error instanceof EnvironmentConfigurationError ? error.message : "Invalid web environment.");
    process.exitCode = 1;
  }
  // Load the official CLI in the same process only after validation; build bypasses this entrypoint.
  if (valid) await import("next/dist/bin/next");
}
