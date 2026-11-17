"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { PASSWORD_MIN_LENGTH, passwordResetInputSchema } from "@lifeos/contracts";
import { authClient } from "@/lib/auth-client";
import { fieldMessages, passwordResetErrorMessage } from "@/lib/auth-errors";
import { Field, FormAlert, SubmitButton, focusFirstInvalid } from "./form-parts";

type Errors = { password?: string; confirmPassword?: string };

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string>();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const parsed = passwordResetInputSchema.safeParse({ token, password: values.get("password") });
    const mismatch = values.get("password") !== values.get("confirmPassword");
    if (!parsed.success || mismatch) {
      const invalid = new Set(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path[0]));
      if (invalid.has("token")) {
        setFormError(passwordResetErrorMessage({ code: "INVALID_TOKEN" }));
        return;
      }
      setErrors({
        password: invalid.has("password") ? fieldMessages.newPassword : undefined,
        confirmPassword: mismatch ? fieldMessages.confirmPassword : undefined,
      });
      focusFirstInvalid(form);
      return;
    }
    setErrors({});
    setFormError(undefined);
    setPending(true);
    let navigating = false;
    try {
      const { error } = await authClient.resetPassword({ newPassword: parsed.data.password, token: parsed.data.token });
      if (error) {
        setFormError(passwordResetErrorMessage(error));
        return;
      }
      navigating = true;
      router.replace("/auth/sign-in?reset=success");
    } catch {
      setFormError(passwordResetErrorMessage(null));
    } finally {
      if (!navigating) setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-5" aria-busy={pending}>
      {formError && <FormAlert tone="error">{formError}</FormAlert>}
      <Field
        id="password" name="password" type="password" label="Новый пароль" autoComplete="new-password" required
        hint={`Не короче ${PASSWORD_MIN_LENGTH} символов. После смены пароля все сессии будут завершены.`} error={errors.password}
      />
      <Field id="confirmPassword" name="confirmPassword" type="password" label="Повторите пароль" autoComplete="new-password" required error={errors.confirmPassword} />
      <SubmitButton pending={pending} pendingLabel="Сохраняем…">Сохранить пароль</SubmitButton>
    </form>
  );
}
