import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { goalIdSchema } from "@lifeos/contracts";
import { LIFE_DOMAINS } from "@lifeos/domain";
import { GoalDetail } from "@/components/goals/goal-detail";
import { requirePageSession } from "@/server/auth";
import { getUserPreferencesService } from "@/server/core";

export const metadata: Metadata = { title: "Цель и измерения" };
export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requirePageSession(`/goals/${id}`);
  const parsed = goalIdSchema.safeParse(id);
  if (!parsed.success) notFound();
  const preferences = await getUserPreferencesService().get(actor);
  return <GoalDetail key={parsed.data.toLowerCase()} id={parsed.data.toLowerCase()} preferences={preferences} domains={LIFE_DOMAINS.map((value) => ({ key: value.key, label: value.name.ru }))} />;
}
