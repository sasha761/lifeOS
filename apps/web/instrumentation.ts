import { PHASE_PRODUCTION_BUILD } from "next/constants";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) {
    const { validateWebEnvironment } = await import("./server/env.ts");
    validateWebEnvironment();
  }
}
