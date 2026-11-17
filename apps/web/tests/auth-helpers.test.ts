import { describe, expect, it } from "vitest";
import { SIGNUP_NOT_ALLOWED } from "@lifeos/contracts";
import {
  passwordResetErrorMessage, passwordResetRequestErrorMessage, signInErrorMessage, signUpErrorMessage,
} from "../lib/auth-errors.ts";
import { DEFAULT_SIGNED_IN_PATH, safeRedirectPath } from "../lib/safe-redirect.ts";

describe("post-sign-in redirect", () => {
  it.each(["/dashboard", "/goals", "/goals?status=active", "/"])("keeps same-origin application paths %s", (path) => {
    expect(safeRedirectPath(path)).toBe(path);
  });
  it.each([
    undefined, "", "dashboard", "https://evil.example/dashboard", "//evil.example", "/\\evil.example", "\\\\evil.example",
    "/auth/sign-in", "/api/auth/sign-out", "/dash\nboard", "javascript:alert(1)", `/${"a".repeat(600)}`,
  ])("falls back to the dashboard for external, auth or malformed targets %#", (path) => {
    expect(safeRedirectPath(path)).toBe(DEFAULT_SIGNED_IN_PATH);
  });
});

describe("auth error messages", () => {
  it("does not reveal whether an account exists on failed sign-in", () => {
    expect(signInErrorMessage({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" })).toBe("Неверный email или пароль.");
    expect(signInErrorMessage({ status: 429 })).toContain("Слишком много попыток");
    expect(signInErrorMessage(null)).toContain("временно недоступен");
  });
  it("explains a closed registration and duplicate accounts", () => {
    expect(signUpErrorMessage({ status: 403, code: SIGNUP_NOT_ALLOWED })).toContain("Регистрация закрыта");
    expect(signUpErrorMessage({ status: 422, code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" })).toContain("уже существует");
    expect(signUpErrorMessage({ status: 400, code: "PASSWORD_TOO_SHORT" })).toContain("Пароль должен содержать");
  });
  it("never reports a sent email when the request failed", () => {
    for (const error of [{ status: 500 }, null]) expect(passwordResetRequestErrorMessage(error)).toBe("Не удалось отправить письмо. Попробуйте ещё раз позже.");
    expect(passwordResetRequestErrorMessage({ status: 429 })).toContain("Слишком много попыток");
  });
  it("treats invalid, expired or reused reset tokens the same way", () => {
    expect(passwordResetErrorMessage({ status: 400, code: "INVALID_TOKEN" })).toContain("недействительна");
    expect(passwordResetErrorMessage({ status: 400, code: "PASSWORD_TOO_SHORT" })).toContain("Пароль должен содержать");
  });
});
