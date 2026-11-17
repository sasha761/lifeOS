import type { Metadata } from "next";
import { NewGoalPage } from "@/components/goals/new-goal";
import type { SearchParams } from "@/lib/search-params";
import { loadNewGoal } from "./new-goal-data";

export const metadata: Metadata = { title: "Новая цель" };

// Direct visit or refresh. A link click inside the web shell opens the same form as a dialog (`@modal/(.)goals/new`).
export default async function NewGoalRoute({ searchParams }: { searchParams: SearchParams }) {
  return <NewGoalPage {...await loadNewGoal(searchParams)} />;
}
