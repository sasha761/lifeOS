"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, CalendarClock, History, Plus } from "lucide-react";
import { dashboardSchema } from "@lifeos/contracts";
import type { Dashboard, DashboardActivity, DashboardDomain, DomainKey, GoalDetails, UserPreferences } from "@lifeos/contracts";
import { domainPresentation } from "../../lib/domain-presentation.ts";
import { activityLabel, dashboardTotals, dueState, formatDay, plural, sourceLabel } from "../../lib/dashboard-presentation.ts";
import { formatGoalValue } from "../../lib/goal-presentation.ts";
import { formatDate, formatDateTime } from "../../lib/user-preferences.ts";
import { GoalAmount, LoadState, useGoalData } from "../goals/shared.tsx";
import { DomainIcon } from "../ui/domain-icon.tsx";
import { ProgressBar } from "../ui/progress-bar.tsx";
import { SectionCard } from "../ui/section-card.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { SourceLabel } from "../ui/source-label.tsx";
import { StatusChip } from "../ui/status-chip.tsx";

type DomainLabels = Record<DomainKey, string>;
const GOAL_FORMS = ["активная цель", "активные цели", "активных целей"] as const;

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

function GoalLine({ value, preferences }: { value: GoalDetails; preferences: UserPreferences }) {
  const { goal, progress } = value;
  return <li className="grid min-w-0 gap-1.5" data-testid="dashboard-goal">
    <Link href={`/goals/${goal.id}`} className="block rounded text-sm leading-5 font-semibold wrap-anywhere hover:underline underline-offset-4">{goal.title}</Link>
    {progress.progressPercent === null
      ? <p className="text-xs leading-5 text-muted-foreground">{progress.explanation}</p>
      : <>
        <ProgressBar value={progress.progressPercent} tone={domainPresentation[goal.domain_key].tone} label={`Прогресс: ${goal.title}`} />
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <GoalAmount value={value} preferences={preferences} percentTestId="dashboard-goal-percent" />
          <SourceLabel className="ml-auto">ручной ввод{progress.provenance && <> · <time dateTime={progress.provenance.measuredAt}>{formatDate(new Date(progress.provenance.measuredAt), preferences)}</time></>}</SourceLabel>
        </div>
      </>}
  </li>;
}

function DomainCard({ domain, label, preferences }: { domain: DashboardDomain; label: string; preferences: UserPreferences }) {
  const more = domain.activeCount - domain.goals.length;
  return <SectionCard role="article" titleId={`dashboard-${domain.key}-title`} headingLevel={3} title={label} data-testid={`dashboard-domain-${domain.key}`}
    icon={<DomainIcon domain={domain.key} />}
    action={domain.activeCount > 0 && <StatusChip tone="outline"><span className="tabular-nums">{domain.activeCount}</span> {plural(domain.activeCount, ["активная", "активные", "активных"])}</StatusChip>}
    contentClassName="flex flex-1 flex-col gap-4">
    {domain.goals.length > 0
      ? <ul className="grid gap-4">{domain.goals.map((value) => <GoalLine key={value.goal.id} value={value} preferences={preferences} />)}</ul>
      : <div className="flex-1">
        <p className="text-sm font-semibold">Нет целей</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{domain.archivedCount > 0 ? "Активных целей нет, архив сохранён." : "Здесь появятся цели этой сферы и их прогресс по вашим измерениям."}</p>
        <Link href={`/goals/new?domain_key=${domain.key}`} className="action-link-secondary action-compact mt-3.5"><Plus aria-hidden="true" className="size-4" />Создать цель</Link>
      </div>}
    {(more > 0 || domain.activeCount + domain.archivedCount > 0) && <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
      <span>{more > 0 ? `Ещё ${more} ${plural(more, ["цель", "цели", "целей"])}` : domain.archivedCount > 0 ? `${domain.archivedCount} в архиве` : ""}</span>
      <Link href={`/goals?domain_key=${domain.key}${domain.activeCount === 0 ? "&status=archived" : ""}`} className="inline-flex min-h-8 items-center gap-1 rounded-full font-medium text-primary">
        Цели сферы <ArrowUpRight aria-hidden="true" className="size-3.5" /></Link>
    </div>}
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
            <span className="text-xs text-muted-foreground"><time dateTime={goal.due_at!}>{formatDateTime(new Date(goal.due_at!), preferences)}</time> · {labels[goal.domain_key]}</span>
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
      : <ol>{dashboard.activity.map((item) => <ActivityRow key={item.id} item={item} labels={labels} preferences={preferences} />)}</ol>}
  </SectionCard>;
}

function DashboardSkeleton() {
  return <div role="status" className="mt-2">
    <span className="sr-only">Загружаем обзор целей…</span>
    <div aria-hidden="true">
      <Skeleton className="h-5 w-72" />
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"><Skeleton className="h-56 rounded-2xl" /><Skeleton className="h-56 rounded-2xl" /></div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-48 rounded-2xl" />)}</div>
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
    <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <TodayCard dashboard={dashboard} labels={labels} preferences={preferences} now={now} />
      <ActivityCard dashboard={dashboard} labels={labels} preferences={preferences} />
    </div>
    <section aria-labelledby="dashboard-spheres-title" className="mt-8">
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="dashboard-spheres-title" className="text-base leading-[22px] font-bold">Сферы жизни</h2>
        <p className="text-xs text-muted-foreground">прогресс конкретных целей по вашим измерениям, не «уровень жизни»</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {dashboard.domains.map((domain) => <DomainCard key={domain.key} domain={domain} label={labels[domain.key]} preferences={preferences} />)}
      </div>
    </section>
  </>;
}
