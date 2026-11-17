"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { signInInputSchema } from "@lifeos/contracts";
import { authClient } from "@/lib/auth-client";
import { fieldMessages, signInErrorMessage } from "@/lib/auth-errors";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { Field, FormAlert, SubmitButton, focusFirstInvalid } from "./form-parts";

type Errors = { email?: string; password?: string };

export function SignInForm({ next, notice }: { next: string; notice?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string>();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const parsed = signInInputSchema.safeParse({ email: values.get("email"), password: values.get("password") });
    if (!parsed.success) {
      const invalid = new Set(parsed.error.issues.map((issue) => issue.path[0]));
      setErrors({
        email: invalid.has("email") ? fieldMessages.email : undefined,
        password: invalid.has("password") ? fieldMessages.currentPassword : undefined,
      });
      focusFirstInvalid(form);
      return;
    }
    setErrors({});
    setFormError(undefined);
    setPending(true);
    let navigating = false;
    try {
      const { error } = await authClient.signIn.email(parsed.data);
      if (error) {
        setFormError(signInErrorMessage(error));
        return;
      }
      navigating = true;
      router.replace(safeRedirectPath(next));
      router.refresh();
    } catch {
      setFormError(signInErrorMessage(null));
    } finally {
      // Stay disabled while navigating so a second click cannot resubmit.
      if (!navigating) setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-5" aria-busy={pending}>
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {formError && <FormAlert tone="error">{formError}</FormAlert>}
      <Field id="email" name="email" type="email" label="Email" autoComplete="email" inputMode="email" required error={errors.email} />
      <Field id="password" name="password" type="password" label="Пароль" autoComplete="current-password" required error={errors.password} />
      <SubmitButton pending={pending} pendingLabel="Входим…">Войти</SubmitButton>
    </form>
  );
}
