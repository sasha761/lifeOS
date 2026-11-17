import { NewGoalDialog } from "@/components/goals/new-goal";
import type { SearchParams } from "@/lib/search-params";
import { loadNewGoal } from "../../../goals/new/new-goal-data";

// Intercepts client-side navigation to /goals/new and shows the form over the current page (mockup 10).
export default async function NewGoalModalRoute({ searchParams }: { searchParams: SearchParams }) {
  return <NewGoalDialog {...await loadNewGoal(searchParams)} />;
}
