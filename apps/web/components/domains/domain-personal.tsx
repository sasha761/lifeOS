"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, Plus } from "lucide-react";
import { activityFeedSchema, goalsPageSchema } from "@lifeos/contracts";
import type { DomainKey, GoalDetails, UserPreferences } from "@lifeos/contracts";
import { describeActivity } from "../../lib/activity-presentation.ts";
import { domainPresentation } from "../../lib/domain-presentation.ts";
import { formatDate, formatDateTime, formatShortDateTime } from "../../lib/user-preferences.ts";
import { GoalAmount, LoadState, useGoalData } from "../goals/shared.tsx";
import { ProgressBar } from "../ui/progress-bar.tsx";
import { SectionCard } from "../ui/section-card.tsx";
import { SourceLabel } from "../ui/source-label.tsx";
import { StatusChip } from "../ui/status-chip.tsx";

const SPHERE_GOALS = 2;
const SPHERE_ACTIVITY = 5;

/** Goal card of mockup 10: title and deadline, bar, «X из Y · %» and the source; links to the goal. */
function SphereGoalCard({ value, preferences, wide }: { value: GoalDetails; preferences: UserPreferences; wide: boolean }) {
  const { goal, progress } = value;
  return <SectionCard role="article" titleId={`sphere-goal-${goal.id}`} headingLevel={3} data-testid="domain-goal" className={wide ? "lg:col-span-2" : undefined}
    title={<Link href={`/goals/${goal.id}`} className="rounded hover:underline underline-offset-4">{goal.title}</Link>}
    action={goal.due_at && <span className="text-xs font-normal text-muted-foreground tabular-nums">до <time dateTime={goal.due_at}>{formatDate(new Date(goal.due_at), preferences)}</time></span>}
    contentClassName="grid gap-2">
    {progress.progressPercent === null
      ? <p className="text-xs leading-5 text-muted-foreground">{progress.explanation}. Добавьте измерение на странице цели.</p>
      : <>
        <ProgressBar value={progress.progressPercent} tone={domainPresentation[goal.domain_key].tone} label={`Прогресс: ${goal.title}`} />
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1"><GoalAmount value={value} preferences={preferences} /><SourceLabel className="ml-auto">ручной ввод</SourceLabel></div>
      </>}
  </SectionCard>;
}

/**
 * Personal part of a sphere page for a signed-in owner (mockup 10, LFS-213): the newest active goals of the sphere and
 * the sphere's own journal. Guests never reach it; the server page shows them the public registry text instead.
 */
export function DomainPersonal({ domainKey, label, preferences, moduleCard }: { domainKey: DomainKey; label: string; preferences: UserPreferences; moduleCard: ReactNode }) {
  const goals = useGoalData(`/api/v1/goals?domain_key=${domainKey}&status=active&limit=${SPHERE_GOALS}`, goalsPageSchema);
  const journal = useGoalData(`/api/v1/activity?domain_key=${domainKey}&limit=${SPHERE_ACTIVITY}`, activityFeedSchema);
  const items = goals.data?.items ?? [];
  return <>
    <div className="mt-4 grid items-stretch gap-4 lg:grid-cols-3">
      {goals.loading || goals.error ? <div className="lg:col-span-2"><LoadState loading={goals.loading} error={goals.error} retry={goals.reload} /></div>
        : !items.length ? <SectionCard titleId="domain-goals-title" title="Целей пока нет" className="lg:col-span-2">
          <p className="text-sm leading-6 text-muted-foreground">Создайте измеримую цель в сфере «{label}» и отмечайте изменения вручную. Прогресс строится по вашим измерениям.</p>
          <Link href={`/goals/new?domain_key=${domainKey}`} className="action-link action-compact mt-4"><Plus aria-hidden="true" className="size-4" />Создать цель</Link>
        </SectionCard>
          : items.map((value) => <SphereGoalCard key={value.goal.id} value={value} preferences={preferences} wide={items.length === 1} />)}
      {moduleCard}
    </div>
    {items.length > 0 && <Link href={`/goals?domain_key=${domainKey}`} className="mt-3 inline-flex min-h-8 items-center gap-1 rounded-full text-xs font-medium text-primary pointer-coarse:min-h-11">
      Все цели сферы <ArrowUpRight aria-hidden="true" className="size-3.5" /></Link>}
    <SectionCard titleId="domain-activity-title" title="Последние действия в сфере" className="mt-4" action={<SourceLabel>журнал действий</SourceLabel>}>
      <LoadState loading={journal.loading} error={journal.error} retry={journal.reload} />
      {journal.data && !journal.loading && !journal.error && (journal.data.items.length === 0
        ? <p className="text-xs leading-5 text-muted-foreground">Действий в этой сфере пока нет.</p>
        : <ol className="grid" data-testid="domain-activity">{journal.data.items.map((entry) => <li key={entry.id} className="grid min-w-0 gap-x-3 gap-y-0.5 border-b py-2 text-sm first:pt-0 last:border-b-0 last:pb-0 sm:grid-cols-[110px_minmax(0,1fr)]">
          <time dateTime={entry.occurredAt} title={formatDateTime(new Date(entry.occurredAt), preferences)} className="text-xs leading-5 text-muted-foreground tabular-nums">{formatShortDateTime(new Date(entry.occurredAt), preferences)}</time>
          <span className="min-w-0 wrap-anywhere">{describeActivity(entry, preferences, { withTitle: true })}{entry.goal.status === "archived" && <> <StatusChip tone="gray">в архиве</StatusChip></>}</span>
        </li>)}</ol>)}
    </SectionCard>
  </>;
}
