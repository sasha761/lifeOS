import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { FormAlert, textLinkClass } from "@/components/auth/form-parts";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { firstParam } from "@/lib/search-params";
import type { SearchParams } from "@/lib/search-params";

// The one-time token is in the query string: never send it to other origins via Referer.
export const metadata: Metadata = { title: "Новый пароль", referrer: "no-referrer" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const token = firstParam(params.token);
  // Better Auth redirects here with ?error=INVALID_TOKEN for unknown, used or expired links.
  const usable = !!token && !firstParam(params.error) && /^[A-Za-z0-9_-]{1,256}$/.test(token);
  return (
    <AuthCard
      title="Новый пароль"
      footer={<Link href="/auth/sign-in" className={textLinkClass}>Вернуться ко входу</Link>}
    >
      {usable ? <ResetPasswordForm token={token} /> : (
        <div className="grid gap-4">
          <FormAlert tone="error">Ссылка недействительна, устарела или уже использована.</FormAlert>
          <Link href="/auth/forgot-password" className="action-link">Запросить новую ссылку</Link>
        </div>
      )}
    </AuthCard>
  );
}
