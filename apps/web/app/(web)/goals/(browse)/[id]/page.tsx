import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { goalIdSchema } from "@lifeos/contracts";
import { SelectedGoal } from "@/components/goals/goals-browser";
import { requirePageSession } from "@/server/auth";

export const metadata: Metadata = { title: "Цель и измерения" };

// Mockup 09: the goal panel beside the list (layout) from 1024px, the whole screen on narrow ones.
export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageSession(`/goals/${id}`);
  const parsed = goalIdSchema.safeParse(id);
  if (!parsed.success) notFound();
  return <SelectedGoal id={parsed.data.toLowerCase()} />;
}
