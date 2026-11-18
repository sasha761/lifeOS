import type { Metadata } from "next";
import { LIFE_DOMAINS } from "@lifeos/domain";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { PageHeader } from "@/components/ui/page-header";
import { requirePageSession } from "@/server/auth";
import { getUserPreferencesService } from "@/server/core";

export const metadata: Metadata = { title: "Мой кабинет" };

// Plain labels for the client view: the domain registry itself stays on the server.
const labels = Object.fromEntries(LIFE_DOMAINS.map((domain) => [domain.key, domain.name.ru])) as Record<(typeof LIFE_DOMAINS)[number]["key"], string>;

// Mockup 04 with Stage 2 data only: the title, a bold lead of real goal counts (in the view), deadlines, journal and spheres.
// Email, time zone and «Выйти» live in /settings (LFS-213).
export default async function DashboardPage() {
  const { actor } = await requirePageSession("/dashboard");
  const preferences = await getUserPreferencesService().get(actor);
  return (
    <>
      <PageHeader title="Мой кабинет" />
      <DashboardView preferences={preferences} labels={labels} />
    </>
  );
}
