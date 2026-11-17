export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type MailSender = {
  readonly transport: "outbox" | "smtp";
  /** Resolves only after the message was accepted by the transport; otherwise throws MailDeliveryError. */
  send: (message: MailMessage) => Promise<void>;
};

/**
 * Delivery failure without a cause: transport errors can echo addresses, credentials or the
 * message body (which contains one-time links), so none of it is kept or logged.
 */
export class MailDeliveryError extends Error {
  constructor() {
    super("Email delivery failed.");
    this.name = "MailDeliveryError";
  }
}
