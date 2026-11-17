"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { passwordResetRequestSchema } from "@lifeos/contracts";
import { authClient } from "@/lib/auth-client";
import { fieldMessages, passwordResetRequestErrorMessage } from "@/lib/auth-errors";
import { Field, FormAlert, SubmitButton, focusFirstInvalid } from "./form-parts";

// Relative path: Better Auth validates it against trusted origins before emailing the link.
const RESET_PASSWORD_PATH = "/auth/reset-password";

export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [emailError, setEmailError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [requested, setRequested] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const parsed = passwordResetRequestSchema.safeParse({ email: new FormData(form).get("email") });
    if (!parsed.success) {
      setEmailError(fieldMessages.email);
      focusFirstInvalid(form);
      return;
    }
    setEmailError(undefined);
    setFormError(undefined);
    setPending(true);
    try {
      const { error } = await authClient.requestPasswordReset({ email: parsed.data.email, redirectTo: RESET_PASSWORD_PATH });
      if (error) setFormError(passwordResetRequestErrorMessage(error));
      else setRequested(true);
    } catch {
      setFormError(passwordResetRequestErrorMessage(null));
    } finally {
      setPending(false);
    }
  }

  if (requested) {
    return (
      <FormAlert tone="success">
        Если аккаунт с этим email существует, мы отправили письмо со ссылкой для нового пароля.
        Ссылка действует 60 минут и срабатывает один раз.
      </FormAlert>
    );
  }
  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-5" aria-busy={pending}>
      {formError && <FormAlert tone="error">{formError}</FormAlert>}
      <Field id="email" name="email" type="email" label="Email" autoComplete="email" inputMode="email" required error={emailError} />
      <SubmitButton pending={pending} pendingLabel="Отправляем…">Отправить ссылку</SubmitButton>
    </form>
  );
}
