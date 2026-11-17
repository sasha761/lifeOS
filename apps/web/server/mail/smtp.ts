import { createTransport } from "nodemailer";
import { MailDeliveryError } from "./types.ts";
import type { MailSender } from "./types.ts";

/**
 * Real delivery through any SMTP provider (production transport).
 * SMTP_URL carries host, port and credentials (smtps:// for implicit TLS on 465; smtp:// upgrades
 * with STARTTLS when the server offers it). Failures surface as MailDeliveryError without details.
 */
export function createSmtpMailSender(options: { url: string; from: string; timeoutMs?: number }): MailSender {
  const timeout = options.timeoutMs ?? 10_000;
  const url = new URL(options.url);
  const transporter = createTransport({
    host: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === "smtps:" ? 465 : 587,
    secure: url.protocol === "smtps:",
    auth: url.username ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } : undefined,
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout,
    logger: false,
    debug: false,
  });
  return {
    transport: "smtp",
    send: async (message) => {
      let rejected = true;
      try {
        const info = await transporter.sendMail({ from: options.from, ...message });
        rejected = info.rejected.length > 0 || info.accepted.length === 0;
      } catch {
        throw new MailDeliveryError();
      }
      if (rejected) throw new MailDeliveryError();
    },
  };
}
