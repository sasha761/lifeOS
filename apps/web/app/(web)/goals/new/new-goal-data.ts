import "server-only";
import { domainKeySchema } from "@lifeos/contracts";
import { LIFE_DOMAINS } from "@lifeos/domain";
import { firstParam } from "@/lib/search-params";
import type { SearchParams } from "@/lib/search-params";
import { requirePageSession } from "@/server/auth";
import { getUserPreferencesService } from "@/server/core";

/** Shared by the /goals/new page and its dialog interception: same session guard, preferences and sphere preset. */
export async function loadNewGoal(searchParams: SearchParams) {
  const { actor } = await requirePageSession("/goals/new");
  const preferences = await getUserPreferencesService().get(actor);
  const domain = domainKeySchema.safeParse(firstParam((await searchParams).domain_key));
  return {
    preferences,
    domainKey: domain.success ? domain.data : undefined,
    domains: LIFE_DOMAINS.map((value) => ({ key: value.key, label: value.name.ru })),
  };
}
