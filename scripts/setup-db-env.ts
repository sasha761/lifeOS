import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const environmentFile = new URL("../.env", import.meta.url);
const password = randomBytes(24).toString("base64url");
const testPassword = randomBytes(24).toString("base64url");
const authSecret = randomBytes(32).toString("base64url");

try {
  writeFileSync(environmentFile, [
    "# Generated local development credentials. Do not commit this file.",
    "POSTGRES_PORT=15432",
    `POSTGRES_PASSWORD=${password}`,
    `DATABASE_URL=postgresql://lifeos:${password}@127.0.0.1:15432/lifeos`,
    "POSTGRES_TEST_PORT=15433",
    `POSTGRES_TEST_PASSWORD=${testPassword}`,
    `TEST_DATABASE_URL=postgresql://lifeos_test:${testPassword}@127.0.0.1:15433/lifeos_test`,
    `BETTER_AUTH_SECRET=${authSecret}`,
    "BETTER_AUTH_URL=http://127.0.0.1:3000",
    "# Comma-separated emails allowed to sign up. Empty: registration closed.",
    "AUTH_SIGNUP_ALLOWLIST=",
    "MAIL_TRANSPORT=outbox",
    "MAIL_FROM=no-reply@lifeos.local",
    "MAIL_OUTBOX_DIR=../../.cache/dev-mail",
    "",
  ].join("\n"), { flag: "wx", mode: 0o600 });
  console.log("Created the root .env with random local PostgreSQL passwords and auth secret. Values are not displayed.");
} catch {
  console.error("Could not create .env. An existing file is never overwritten; configure its database variables manually.");
  process.exitCode = 1;
}
