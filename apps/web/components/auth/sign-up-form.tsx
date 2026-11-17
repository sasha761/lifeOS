"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { PASSWORD_MIN_LENGTH, signUpInputSchema } from "@lifeos/contracts";
import { authClient } from "@/lib/auth-client";
import { fieldMessages, signUpErrorMessage } from "@/lib/auth-errors";
import { DEFAULT_SIGNED_IN_PATH } from "@/lib/safe-redirect";
import { Field, FormAlert, SubmitButton, focusFirstInvalid } from "./form-parts";

type Errors = { name?: string; email?: string; password?: string; confirmPassword?: string };

export function SignUpForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string>();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const parsed = signUpInputSchema.safeParse({ name: values.get("name"), email: values.get("email"), password: values.get("password") });
    const invalid = new Set(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path[0]));
    const mismatch = values.get("password") !== values.get("confirmPassword");
    if (!parsed.success || mismatch) {
      setErrors({
        name: invalid.has("name") ? fieldMessages.name : undefined,
        email: invalid.has("email") ? fieldMessages.email : undefined,
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
      // The allowlist is enforced by the server; this form cannot bypass it.
      const { error } = await authClient.signUp.email(parsed.data);
      if (error) {
        setFormError(signUpErrorMessage(error));
        return;
      }
      navigating = true;
      router.replace(DEFAULT_SIGNED_IN_PATH);
      router.refresh();
    } catch {
      setFormError(signUpErrorMessage(null));
    } finally {
      if (!navigating) setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-5" aria-busy={pending}>
      {formError && <FormAlert tone="error">{formError}</FormAlert>}
      <Field id="name" name="name" label="Имя" autoComplete="name" required maxLength={100} error={errors.name} />
      <Field id="email" name="email" type="email" label="Email" autoComplete="email" inputMode="email" required error={errors.email} />
      <Field
        id="password" name="password" type="password" label="Пароль" autoComplete="new-password" required
        hint={`Не короче ${PASSWORD_MIN_LENGTH} символов.`} error={errors.password}
      />
      <Field id="confirmPassword" name="confirmPassword" type="password" label="Повторите пароль" autoComplete="new-password" required error={errors.confirmPassword} />
      <SubmitButton pending={pending} pendingLabel="Создаём аккаунт…">Создать аккаунт</SubmitButton>
    </form>
  );
}
