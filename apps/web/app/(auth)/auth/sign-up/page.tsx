import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { textLinkClass } from "@/components/auth/form-parts";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { DEFAULT_SIGNED_IN_PATH } from "@/lib/safe-redirect";
import { getPageUser, getSignupMode } from "@/server/auth";

export const metadata: Metadata = { title: "Регистрация" };

export default async function SignUpPage() {
  if (await getPageUser()) redirect(DEFAULT_SIGNED_IN_PATH);
  return (
    <AuthCard
      title="Регистрация"
      description={getSignupMode() === "open"
        ? "Создайте аккаунт, чтобы вести цели и следить за прогрессом."
        : "Регистрация закрыта: создать аккаунт можно только с email из списка приглашённых."}
      footer={<p className="text-muted-foreground">Уже есть аккаунт? <Link href="/auth/sign-in" className={textLinkClass}>Войти</Link></p>}
    >
      <SignUpForm />
    </AuthCard>
  );
}
