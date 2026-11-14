import { readWorkerEnv } from "@lifeos/config/env";

export type WorkerConfiguration = { connectionString: string; schema: string };

export function readWorkerConfiguration(environment: NodeJS.ProcessEnv): WorkerConfiguration {
  const env = readWorkerEnv(environment);
  return { connectionString: env.DATABASE_URL, schema: env.WORKER_QUEUE_SCHEMA };
}
