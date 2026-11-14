import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

type VerificationStep = { name: string; args: string[]; build?: boolean };
const steps: VerificationStep[] = [
  { name: "frozen install", args: ["install", "--frozen-lockfile"] },
  { name: "lint", args: ["lint"] },
  { name: "typecheck", args: ["typecheck"] },
  { name: "unit tests", args: ["test", "--force"] },
  { name: "test database migrations", args: ["db:migrate:test"] },
  { name: "PostgreSQL integration tests", args: ["test:integration"] },
  { name: "Web and worker builds", args: ["build"], build: true },
  { name: "build smoke", args: ["test:build"], build: true },
];
const root = fileURLToPath(new URL("../", import.meta.url));

async function main(): Promise<void> {
  const nodeVersion = (await readFile(new URL("../.nvmrc", import.meta.url), "utf8")).trim();
  if (process.versions.node !== nodeVersion) throw new Error(`Verification requires Node.js ${nodeVersion} from .nvmrc.`);
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli) throw new Error("Run verification through pnpm verify.");
  const environment: NodeJS.ProcessEnv = {
    ...process.env, CI: "true", TURBO_FORCE: "true",
    NEXT_TELEMETRY_DISABLED: "1", TURBO_TELEMETRY_DISABLED: "1",
  };
  const buildEnvironment = { ...environment };
  for (const key of Object.keys(buildEnvironment)) {
    if (["DATABASE_URL", "TEST_DATABASE_URL", "WORKER_QUEUE_SCHEMA"].includes(key) || /^(TELEGRAM_|AI_|OPENAI_|ANTHROPIC_)/.test(key)) delete buildEnvironment[key];
  }
  for (const step of steps) {
    console.log(`verify: ${step.name}`);
    // Invoke pnpm's JS entrypoint using the pinned Node, including on Windows; no shell or command interpolation.
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, [pnpmCli, ...step.args], {
        cwd: root, stdio: "inherit", env: step.build ? buildEnvironment : environment, windowsHide: true,
      });
      child.once("error", () => reject(new Error(`Could not start verification step: ${step.name}.`)));
      child.once("close", (code) => resolve(code ?? 1));
    });
    if (code !== 0) {
      console.error(`verify: failed at ${step.name}`);
      process.exitCode = code;
      return;
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Verification setup failed.");
  process.exitCode = 1;
});
