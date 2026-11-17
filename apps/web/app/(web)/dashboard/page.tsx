import type { Metadata } from "next";
import Link from "next/link";
import { Settings } from "lucide-react";
import { LIFE_DOMAINS } from "@lifeos/domain";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader
        title={`Здравствуйте, ${user.name}`}
        description={<>Вы вошли как <strong>{user.email}</strong> · Часовой пояс: <strong>{preferences.timezone}</strong></>}
        actions={<>
          <Link href="/settings" className="action-link-secondary action-compact"><Settings aria-hidden="true" className="size-4" /> Настройки</Link>
          <SignOutButton />
        </>}
      />
      <DashboardView preferences={preferences} labels={labels} />
    </>
  );
}
