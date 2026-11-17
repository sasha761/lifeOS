import type { MailSettings } from "@lifeos/config/env";
import { createOutboxMailSender } from "./outbox.ts";
import { createSmtpMailSender } from "./smtp.ts";
import type { MailSender } from "./types.ts";

export function createMailSender(settings: MailSettings): MailSender {
  return settings.transport === "smtp"
    ? createSmtpMailSender({ url: settings.url, from: settings.from })
    : createOutboxMailSender({ directory: settings.directory, from: settings.from });
}

export { passwordResetMessage } from "./messages.ts";
export { MailDeliveryError } from "./types.ts";
export type { MailMessage, MailSender } from "./types.ts";
