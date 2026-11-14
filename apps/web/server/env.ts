import "server-only";
import { readWebEnv } from "@lifeos/config/env";

// Explicit startup call only; importing this module does not validate env.
export function validateWebEnvironment(): void {
  readWebEnv(process.env);
}
