import { Suspense } from "react";
import type { ReactNode } from "react";
import { LIFE_DOMAINS } from "@lifeos/domain";
import { GoalsBrowser } from "@/components/goals/goals-browser";
import { getPageSession } from "@/server/auth";
import { getUserPreferencesService } from "@/server/core";

// Mockup 09 (LFS-213): the list lives in this layout, so moving between /goals and /goals/[id] keeps it and the focused
// link in place; the pages render only the goal panel. Each page still guards its own session (and redirects with the
// exact `next`); without a session the layout adds nothing.
export default async function GoalsBrowseLayout({ children }: { children: ReactNode }) {
  const session = await getPageSession();
  if (!session) return children;
  const preferences = await getUserPreferencesService().get(session.actor);
  return <Suspense>
    <GoalsBrowser preferences={preferences} domains={LIFE_DOMAINS.map((value) => ({ key: value.key, label: value.name.ru }))}>{children}</GoalsBrowser>
  </Suspense>;
}
