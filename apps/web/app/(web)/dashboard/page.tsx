import type { Metadata } from "next";
import Link from "next/link";
import { Settings } from "lucide-react";
import { LIFE_DOMAINS } from "@lifeos/domain";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { requirePageSession } from "@/server/auth";
import { getUserPreferencesService } from "@/server/core";

export const metadata: Metadata = { title: "Мой кабинет" };

// Plain labels for the client view: the domain registry itself stays on the server.
const labels = Object.fromEntries(LIFE_DOMAINS.map((domain) => [domain.key, domain.name.ru])) as Record<(typeof LIFE_DOMAINS)[number]["key"], string>;

export default async function DashboardPage() {
  const { user, actor } = await requirePageSession("/dashboard");
  const preferences = await getUserPreferencesService().get(actor);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">Мой кабинет</p>
          <h1 className="page-title mt-1 wrap-anywhere">Здравствуйте, {user.name}</h1>
          <p className="mt-2 text-xs leading-5 text-muted-foreground wrap-anywhere">
            Вы вошли как <span className="font-medium text-foreground">{user.email}</span> · Часовой пояс: <span className="font-medium text-foreground">{preferences.timezone}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <Link href="/settings" className="action-link-secondary">
            <Settings aria-hidden="true" className="size-4" /> Настройки
          </Link>
          <SignOutButton />
        </div>
      </div>
      <DashboardView preferences={preferences} labels={labels} />
    </>
  );
}
