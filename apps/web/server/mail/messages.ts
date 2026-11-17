import type { MailMessage } from "./types.ts";

const escapeHtml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#39;");

/** One-time password reset link. The URL is the only secret in the message and is never logged. */
export function passwordResetMessage(options: { to: string; url: string; expiresInMinutes: number }): MailMessage {
  const { to, url, expiresInMinutes } = options;
  return {
    to,
    subject: "LifeOS: восстановление доступа",
    text: [
      "Вы запросили восстановление доступа к LifeOS.",
      "",
      `Чтобы задать новый пароль, откройте ссылку (действует ${expiresInMinutes} минут и только один раз):`,
      url,
      "",
      "Если вы не запрашивали восстановление, просто проигнорируйте это письмо: пароль останется прежним.",
    ].join("\n"),
    html: [
      "<p>Вы запросили восстановление доступа к LifeOS.</p>",
      `<p><a href="${escapeHtml(url)}">Задать новый пароль</a></p>`,
      `<p>Ссылка действует ${expiresInMinutes} минут и только один раз.</p>`,
      "<p>Если вы не запрашивали восстановление, просто проигнорируйте это письмо: пароль останется прежним.</p>",
    ].join("\n"),
  };
}
