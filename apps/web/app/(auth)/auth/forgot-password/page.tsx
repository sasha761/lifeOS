import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { textLinkClass } from "@/components/auth/form-parts";

export const metadata: Metadata = { title: "Восстановление доступа" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Восстановление доступа"
      description="Укажите email аккаунта — мы пришлём одноразовую ссылку для нового пароля."
      footer={<Link href="/auth/sign-in" className={textLinkClass}>Вернуться ко входу</Link>}
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
