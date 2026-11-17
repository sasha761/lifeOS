import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { textLinkClass } from "@/components/auth/form-parts";
import { SignInForm } from "@/components/auth/sign-in-form";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { firstParam } from "@/lib/search-params";
import type { SearchParams } from "@/lib/search-params";
import { getPageUser } from "@/server/auth";

export const metadata: Metadata = { title: "Вход" };

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeRedirectPath(firstParam(params.next));
  if (await getPageUser()) redirect(next);
  const notice = firstParam(params.reset) === "success" ? "Пароль изменён. Войдите с новым паролем." : undefined;
  return (
    <AuthCard
      title="Вход в LifeOS"
      description="Войдите, чтобы открыть личный кабинет."
      footer={(
        <>
          <Link href="/auth/forgot-password" className={textLinkClass}>Забыли пароль?</Link>
          <p className="text-muted-foreground">
            Нет аккаунта? <Link href="/auth/sign-up" className={textLinkClass}>Регистрация по приглашению</Link>
          </p>
        </>
      )}
    >
      <SignInForm next={next} notice={notice} />
    </AuthCard>
  );
}
