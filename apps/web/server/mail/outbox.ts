import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MailDeliveryError } from "./types.ts";
import type { MailMessage, MailSender } from "./types.ts";

export type OutboxMessage = MailMessage & { id: string; from: string; createdAt: string };

/**
 * Explicit development/test transport (env validation forbids it in production).
 * Each message becomes one JSON file in an ignored local directory; nothing is printed,
 * so one-time links never reach logs. Relative directories resolve from the process cwd.
 */
export function createOutboxMailSender(options: { directory: string; from: string }): MailSender {
  const directory = resolve(options.directory);
  return {
    transport: "outbox",
    send: async (message) => {
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      const entry: OutboxMessage = { id, createdAt, from: options.from, ...message };
      const fileName = `${createdAt.replaceAll(":", "-")}-${id}.json`;
      try {
        await mkdir(directory, { recursive: true });
        // Write then rename so readers never observe a partially written message.
        const temporary = join(directory, `.${fileName}.tmp`);
        await writeFile(temporary, `${JSON.stringify(entry, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
        await rename(temporary, join(directory, fileName));
      } catch {
        throw new MailDeliveryError();
      }
    },
  };
}
