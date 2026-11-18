import type { Metadata } from "next";
import { SelectedGoal } from "@/components/goals/goals-browser";
import { requirePageSession } from "@/server/auth";

export const metadata: Metadata = { title: "Цели" };

// The list and filters are in the layout; here the first goal of the list is shown beside it from 1024px.
export default async function GoalsPage() {
  await requirePageSession("/goals");
  return <SelectedGoal />;
}
