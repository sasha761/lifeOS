import type { Metadata } from "next";
import { domainKeySchema, goalStatusSchema } from "@lifeos/contracts";
import { LIFE_DOMAINS } from "@lifeos/domain";
import { GoalsList } from "@/components/goals/goals-list";
import { firstParam } from "@/lib/search-params";
import type { SearchParams } from "@/lib/search-params";
import { requirePageSession } from "@/server/auth";
import { getUserPreferencesService } from "@/server/core";

export const metadata: Metadata = { title: "Цели" };

export default async function GoalsPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requirePageSession("/goals");
  const preferences = await getUserPreferencesService().get(actor);
  const query = await searchParams;
  const domain = domainKeySchema.safeParse(firstParam(query.domain_key));
  const status = goalStatusSchema.safeParse(firstParam(query.status) ?? "active");
  return <GoalsList key={`${domain.success ? domain.data : "all"}:${status.success ? status.data : "all"}`} preferences={preferences}
    domains={LIFE_DOMAINS.map((value) => ({ key: value.key, label: value.name.ru }))} domainKey={domain.success ? domain.data : undefined} status={status.success ? status.data : undefined} />;
}
