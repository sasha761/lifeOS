import type { Metadata } from "next";
import Link from "next/link";
import { domainKeySchema } from "@lifeos/contracts";
import { LIFE_DOMAINS } from "@lifeos/domain";
import { GoalForm } from "@/components/goals/goal-form";
import { firstParam } from "@/lib/search-params";
import type { SearchParams } from "@/lib/search-params";
import { requirePageSession } from "@/server/auth";
import { getUserPreferencesService } from "@/server/core";

export const metadata: Metadata = { title: "Новая цель" };
export default async function NewGoalPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requirePageSession("/goals/new");
  const preferences = await getUserPreferencesService().get(actor);
  const domain = domainKeySchema.safeParse(firstParam((await searchParams).domain_key));
  return <div className="max-w-2xl"><Link href="/goals" className="inline-flex min-h-11 items-center rounded text-sm text-muted-foreground">← Все цели</Link>
    <p className="mt-4 text-sm text-muted-foreground">Ориентир для следующего шага</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Новая цель</h1>
    <p className="mt-3 text-sm leading-7 text-muted-foreground">Задайте направление и измеримое значение. Прогресс появится после первого ручного измерения.</p>
    <div className="mt-7 min-w-0 rounded-2xl border bg-card p-5 sm:p-7"><GoalForm preferences={preferences} domainKey={domain.success ? domain.data : undefined}
      domains={LIFE_DOMAINS.map((value) => ({ key: value.key, label: value.name.ru }))} /></div></div>;
}
