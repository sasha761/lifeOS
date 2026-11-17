import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import type { AddressInfo, Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMailSender, MailDeliveryError, passwordResetMessage } from "../server/mail/index.ts";
import type { OutboxMessage } from "../server/mail/outbox.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lfs201-mail-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

/** Minimal plain SMTP server (no TLS/AUTH) that records the envelope and DATA of each message. */
async function fakeSmtpServer(): Promise<{ port: number; commands: string[]; messages: string[] }> {
  const commands: string[] = [];
  const messages: string[] = [];
  const server: Server = createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    let data: string[] | undefined;
    socket.write("220 fake.smtp ESMTP\r\n");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (let end = buffer.indexOf("\r\n"); end >= 0; end = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === ".") {
            messages.push(data.join("\n"));
            data = undefined;
            socket.write("250 2.0.0 queued\r\n");
          } else data.push(line.startsWith("..") ? line.slice(1) : line);
          continue;
        }
        commands.push(line);
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "EHLO" || verb === "HELO") socket.write("250 fake.smtp\r\n");
        else if (verb === "DATA") {
          data = [];
          socket.write("354 end with <CRLF>.<CRLF>\r\n");
        } else if (verb === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanups.push(() => new Promise((resolve) => server.close(() => resolve())));
  return { port: (server.address() as AddressInfo).port, commands, messages };
}

async function closedPort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe("password reset message", () => {
  it("contains the one-time link and escapes it in HTML", () => {
    const message = passwordResetMessage({ to: "owner@example.test", url: "https://lifeos.test/r/abc?x=1&y=\"2\"", expiresInMinutes: 60 });
    expect(message.text).toContain("https://lifeos.test/r/abc?x=1&y=\"2\"");
    expect(message.html).toContain("href=\"https://lifeos.test/r/abc?x=1&amp;y=&quot;2&quot;\"");
    expect(message.text).toContain("60 минут");
  });
});

describe("outbox transport (development/test)", () => {
  it("writes each message as one JSON file without printing it", async () => {
    const directory = await temporaryDirectory();
    const sender = createMailSender({ transport: "outbox", from: "no-reply@lifeos.test", directory });
    await sender.send({ to: "owner@example.test", subject: "Subject", text: "link https://lifeos.test/token123", html: "<p>x</p>" });
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json"));
    expect(files).toHaveLength(1);
    const entry = JSON.parse(await readFile(join(directory, files[0] ?? ""), "utf8")) as OutboxMessage;
    expect(entry).toMatchObject({ from: "no-reply@lifeos.test", to: "owner@example.test", subject: "Subject" });
    expect(entry.text).toContain("token123");
    expect(sender.transport).toBe("outbox");
  });
  it("reports a failure when the outbox cannot be written", async () => {
    const directory = await temporaryDirectory();
    const blocked = join(directory, "not-a-directory");
    await writeFile(blocked, "x");
    const sender = createMailSender({ transport: "outbox", from: "no-reply@lifeos.test", directory: blocked });
    await expect(sender.send({ to: "a@example.test", subject: "s", text: "t", html: "h" })).rejects.toBeInstanceOf(MailDeliveryError);
  });
});

describe("SMTP transport (production)", () => {
  it("delivers the envelope and body over the SMTP protocol", async () => {
    const smtp = await fakeSmtpServer();
    const sender = createMailSender({ transport: "smtp", from: "no-reply@lifeos.test", url: `smtp://127.0.0.1:${smtp.port}` });
    await sender.send({ to: "owner@example.test", subject: "Reset", text: "Open https://lifeos.test/api/auth/reset-password/Tok3nValue", html: "<p>x</p>" });
    expect(smtp.commands).toEqual(expect.arrayContaining(["MAIL FROM:<no-reply@lifeos.test>", "RCPT TO:<owner@example.test>", "DATA"]));
    expect(smtp.messages).toHaveLength(1);
    expect(smtp.messages[0]?.replaceAll("=\n", "")).toContain("Tok3nValue");
  });
  it("fails without leaking the message or credentials when the server is unreachable", async () => {
    const port = await closedPort();
    const sender = createMailSender({ transport: "smtp", from: "no-reply@lifeos.test", url: `smtp://mailer:do-not-log@127.0.0.1:${port}` });
    const failure = await sender.send({ to: "owner@example.test", subject: "Reset", text: "https://lifeos.test/secret-link", html: "h" })
      .then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(MailDeliveryError);
    expect(String(failure)).not.toMatch(/secret-link|do-not-log|owner@example/);
    expect(failure).not.toHaveProperty("cause");
  });
});
