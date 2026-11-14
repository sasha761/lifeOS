import { EnvironmentConfigurationError, readWebEnv } from "@lifeos/config/env";

const command = process.argv[2];
if (command !== "dev" && command !== "start") {
  console.error("Use the web dev or start script.");
  process.exitCode = 1;
} else {
  let valid = false;
  try {
    readWebEnv(process.env);
    valid = true;
  } catch (error: unknown) {
    console.error(error instanceof EnvironmentConfigurationError ? error.message : "Invalid web environment.");
    process.exitCode = 1;
  }
  // Load the official CLI in the same process only after validation; build bypasses this entrypoint.
  if (valid) await import("next/dist/bin/next");
}
