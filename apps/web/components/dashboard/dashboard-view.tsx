"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarClock, History, Plus } from "lucide-react";
import { dashboardSchema } from "@lifeos/contracts";
import type { Dashboard, DashboardActivity, DashboardDomain, DomainKey, GoalDetails, UserPreferences } from "@lifeos/contracts";
import { domainPresentation } from "../../lib/domain-presentation.ts";
import { activityLabel, dashboardTotals, dueState, formatDay, plural, sourceLabel } from "../../lib/dashboard-presentation.ts";
import { formatGoalValue } from "../../lib/goal-presentation.ts";
import { formatDate, formatDateTime } from "../../lib/user-preferences.ts";
import { GoalAmount, LoadState, useGoalData } from "../goals/shared.tsx";
import { ProgressBar } from "../ui/progress-bar.tsx";
import { SectionCard } from "../ui/section-card.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { SourceLabel } from "../ui/source-label.tsx";
import { StatusChip } from "../ui/status-chip.tsx";
import { ToneDot } from "../ui/tone-dot.tsx";

type DomainLabels = Record<DomainKey, string>;
const GOAL_FORMS = ["активная цель", "активные цели", "активных целей"] as const;
/** The right card of the first row stays about as tall as «Сегодня» (LFS-213); the API keeps its own limit. */
const DASHBOARD_ACTIVITY_SHOWN = 5;

/** Bold lead under the page title, as in mockup 04 («23 задачи за неделю. …»), counted from real goals only. */
function Summary({ dashboard }: { dashboard: Dashboard }) {
  const { active, archived, spheres } = dashboardTotals(dashboard);
  if (active === 0 && archived === 0) {
    return <p className="mt-2 text-sm leading-6 text-muted-foreground">Целей пока нет. Выберите сферу ниже и создайте первую цель — прогресс появится после первого измерения.</p>;
  }
  return <p className="mt-2 text-sm leading-6 text-muted-foreground" data-testid="dashboard-summary">
    <strong className="font-semibold text-foreground"><span className="tabular-nums">{active}</span> {plural(active, GOAL_FORMS)}
      {active > 0 && <> в <span className="tabular-nums">{spheres}</span> {plural(spheres, ["сфере", "сферах", "сферах"])}</>}.</strong>
    {archived > 0 && <> <span className="tabular-nums">{archived}</span> в архиве.</>}
  </p>;
}

/** Newest active goal of the sphere: its bar and «X из Y · %», or why there is no percentage. */
function SphereGoal({ value, preferences }: { value: GoalDetails; preferences: UserPreferences }) {
  const { goal, progress } = value;
  return progress.progressPercent === null
    ? <p className="col-span-full text-xs leading-5 text-muted-foreground sm:col-span-2 sm:text-right" data-testid="dashboard-goal">{progress.explanation}</p>
    : <>
      <ProgressBar value={progress.progressPercent} tone={domainPresentation[goal.domain_key].tone} label={`Прогресс: ${goal.title}`}
        className="col-span-full row-start-2 sm:col-span-1 sm:col-start-3 sm:row-start-1" />
      <p className="text-right text-xs leading-5 text-muted-foreground" data-testid="dashboard-goal"><GoalAmount value={value} preferences={preferences} percentTestId="dashboard-goal-percent" /></p>
    </>;
}

/**
 * One row of «Сферы жизни» (mockup 04): colour dot, sphere name, bar and value of the newest active goal (LFS-213).
 * There is no sphere percentage or score: a sphere without measurements says so, an empty one offers a goal.
 */
function SphereRow({ domain, label, preferences }: { domain: DashboardDomain; label: string; preferences: UserPreferences }) {
  const [newest] = domain.goals;
  const more = domain.activeCount - (newest ? 1 : 0);
  const href = `/goals?domain_key=${domain.key}${domain.activeCount === 0 && domain.archivedCount > 0 ? "&status=archived" : ""}`;
  return <li data-testid={`dashboard-domain-${domain.key}`}
    className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 py-2 sm:grid-cols-[auto_92px_minmax(0,1fr)_210px] sm:py-1.5">
    <ToneDot tone={domainPresentation[domain.key].tone} />
    <span className="flex min-w-0 items-center gap-1.5">
      <Link href={href} aria-label={newest ? `${label}: ${newest.goal.title}` : `${label}: цели сферы`} title={newest?.goal.title}
        className="rounded text-[13px] leading-5 font-semibold hover:underline underline-offset-4">{label}</Link>
      {more > 0 && newest && <span className="text-xs text-muted-foreground tabular-nums" title={`Ещё ${more} ${plural(more, ["цель", "цели", "целей"])}`}>+{more}</span>}
    </span>
    {newest
      ? <SphereGoal value={newest} preferences={preferences} />
      : <p className="col-span-full flex flex-wrap items-center justify-end gap-x-2.5 text-xs leading-5 text-muted-foreground sm:col-span-2">
        {domain.archivedCount > 0 ? "Активных целей нет" : "Нет целей"}
        <Link href={`/goals/new?domain_key=${domain.key}`} className="inline-flex min-h-8 items-center gap-1 rounded font-medium text-primary pointer-coarse:min-h-11">
          <Plus aria-hidden="true" className="size-3.5" />Создать цель</Link>
      </p>}
  </li>;
}

/** «Сферы жизни» as the full-width block of bars in mockup 04: all six registry spheres in order. */
function SpheresCard({ dashboard, labels, preferences }: { dashboard: Dashboard; labels: DomainLabels; preferences: UserPreferences }) {
  return <SectionCard titleId="dashboard-spheres-title" title="Сферы жизни" className="mt-4"
    description={<span className="sm:hidden">прогресс целей, не «уровень жизни»</span>}
    action={<span className="hidden text-xs font-normal text-muted-foreground sm:inline">прогресс целей, не «уровень жизни»</span>}>
    <ul className="grid divide-y sm:divide-y-0">{dashboard.domains.map((domain) => <SphereRow key={domain.key} domain={domain} label={labels[domain.key]} preferences={preferences} />)}</ul>
  </SectionCard>;
}

const DUE_TONES = { overdue: "red", today: "orange", upcoming: "outline" } as const;

function TodayCard({ dashboard, labels, preferences, now }: { dashboard: Dashboard; labels: DomainLabels; preferences: UserPreferences; now: Date }) {
  const items = dashboard.today.dueGoals;
  return <SectionCard titleId="dashboard-today-title" title="Сегодня" icon={<CalendarClock aria-hidden="true" className="size-[18px] text-today" />}
    action={<span className="text-xs font-normal text-muted-foreground">{formatDay(now, preferences)}</span>}>
    {items.length === 0
      ? <p className="text-xs leading-5 text-muted-foreground">Нет целей со сроком. Срок можно указать при создании или изменении цели.</p>
      : <ul className="grid gap-2">{items.map(({ goal }) => {
        const state = dueState(goal.due_at!, now, preferences.timezone);
        return <li key={goal.id} className="min-w-0 rounded-xl border bg-surface-2 px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip tone={DUE_TONES[state]}>{state === "overdue" ? "Просрочено" : state === "today" ? "Сегодня" : "Срок"}</StatusChip>
            <span className="text-xs text-muted-foreground">до <time dateTime={goal.due_at!}>{formatDate(new Date(goal.due_at!), preferences)}</time> · {labels[goal.domain_key]}</span>
          </div>
          <Link href={`/goals/${goal.id}`} className="mt-1 block rounded text-sm font-semibold wrap-anywhere hover:underline underline-offset-4">{goal.title}</Link>
        </li>;
      })}</ul>}
    <p className="mt-3.5 text-xs text-muted-foreground">Активные цели со сроком, ближайшие первыми.</p>
  </SectionCard>;
}

function ActivityRow({ item, labels, preferences }: { item: DashboardActivity; labels: DomainLabels; preferences: UserPreferences }) {
  return <li className="min-w-0 border-b py-2.5 first:pt-0 last:border-b-0 last:pb-0" data-testid="dashboard-activity">
    <p className="text-sm">
      <span className="font-medium">{activityLabel(item.type)}</span>
      {item.measurement && <span className="font-semibold tabular-nums"> {formatGoalValue(item.measurement.value, { unit: item.measurement.unit, unit_label: item.measurement.unitLabel }, preferences.locale)}</span>}
    </p>
    <Link href={`/goals/${item.goal.id}`} className="mt-0.5 block rounded text-sm text-muted-foreground wrap-anywhere hover:text-foreground hover:underline underline-offset-4">{item.goal.title}</Link>
    <p className="mt-1 text-xs text-muted-foreground"><time dateTime={item.occurredAt}>{formatDateTime(new Date(item.occurredAt), preferences)}</time> · {labels[item.domainKey]} · {sourceLabel(item.source)}</p>
  </li>;
}

function ActivityCard({ dashboard, labels, preferences }: { dashboard: Dashboard; labels: DomainLabels; preferences: UserPreferences }) {
  return <SectionCard titleId="dashboard-activity-title" title="Последние действия" icon={<History aria-hidden="true" className="size-[18px] text-primary" />}
    action={<SourceLabel>журнал действий</SourceLabel>}>
    {dashboard.activity.length === 0
      ? <p className="text-xs leading-5 text-muted-foreground">Действий пока нет. Здесь появятся созданные цели и измерения.</p>
      : <ol>{dashboard.activity.slice(0, DASHBOARD_ACTIVITY_SHOWN).map((item) => <ActivityRow key={item.id} item={item} labels={labels} preferences={preferences} />)}</ol>}
  </SectionCard>;
}

function DashboardSkeleton() {
  return <div role="status" className="mt-2">
    <span className="sr-only">Загружаем обзор целей…</span>
    <div aria-hidden="true">
      <Skeleton className="h-5 w-72" />
      <div className="mt-4 grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]"><Skeleton className="h-56 rounded-2xl" /><Skeleton className="h-56 rounded-2xl" /></div>
      <Skeleton className="mt-4 h-60 rounded-2xl" />
    </div>
  </div>;
}

/** Client part of /dashboard: reads GET /api/v1/dashboard with loading, error/retry and empty states. */
export function DashboardView({ preferences, labels }: { preferences: UserPreferences; labels: DomainLabels }) {
  const resource = useGoalData("/api/v1/dashboard", dashboardSchema);
  const [now] = useState(() => new Date());
  if (resource.error) return <LoadState loading={false} error={resource.error} retry={resource.reload} />;
  if (resource.loading || !resource.data) return <DashboardSkeleton />;
  const dashboard = resource.data;
  return <>
    <Summary dashboard={dashboard} />
    <div className="mt-4 grid items-start gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
      <TodayCard dashboard={dashboard} labels={labels} preferences={preferences} now={now} />
      <ActivityCard dashboard={dashboard} labels={labels} preferences={preferences} />
    </div>
    <SpheresCard dashboard={dashboard} labels={labels} preferences={preferences} />
  </>;
}
