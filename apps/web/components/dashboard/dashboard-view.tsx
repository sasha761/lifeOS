"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, CalendarClock, History, Plus } from "lucide-react";
import { dashboardSchema } from "@lifeos/contracts";
import type { Dashboard, DashboardActivity, DashboardDomain, DomainKey, GoalDetails, UserPreferences } from "@lifeos/contracts";
import { domainPresentation } from "../../lib/domain-presentation.ts";
import { activityLabel, dashboardTotals, dueState, formatDay, plural, sourceLabel } from "../../lib/dashboard-presentation.ts";
import { formatGoalPercent, formatGoalValue } from "../../lib/goal-presentation.ts";
import { formatDateTime } from "../../lib/user-preferences.ts";
import { LoadState, progressClass, useGoalData } from "../goals/shared.tsx";
import { Skeleton } from "../ui/skeleton.tsx";

type DomainLabels = Record<DomainKey, string>;
const GOAL_FORMS = ["активная цель", "активные цели", "активных целей"] as const;
const card = "min-w-0 rounded-2xl border bg-card p-5 sm:p-6";

function Summary({ dashboard }: { dashboard: Dashboard }) {
  const { active, archived, spheres } = dashboardTotals(dashboard);
  if (active === 0 && archived === 0) {
    return <p className="mt-6 text-sm leading-6 text-muted-foreground">Целей пока нет. Выберите сферу ниже и создайте первую цель — прогресс появится после первого измерения.</p>;
  }
  return <p className="mt-6 text-[15px] leading-6 text-muted-foreground" data-testid="dashboard-summary">
    <strong className="font-semibold text-foreground tabular-nums">{active}</strong> {plural(active, GOAL_FORMS)}
    {active > 0 && <> в <strong className="font-semibold text-foreground tabular-nums">{spheres}</strong> {plural(spheres, ["сфере", "сферах", "сферах"])}</>}
    {archived > 0 && <> · <span className="tabular-nums">{archived}</span> в архиве</>}.
  </p>;
}

function GoalLine({ value, preferences }: { value: GoalDetails; preferences: UserPreferences }) {
  const { goal, progress } = value;
  return <li className="min-w-0" data-testid="dashboard-goal">
    <Link href={`/goals/${goal.id}`} className="block wrap-anywhere rounded text-sm font-semibold hover:underline underline-offset-4">{goal.title}</Link>
    {progress.progressPercent === null
      ? <p className="mt-1 text-xs text-muted-foreground">{progress.explanation}</p>
      : <div className="mt-2 flex items-center gap-3">
        <progress max={100} value={progress.progressPercent} aria-label={`Прогресс: ${goal.title}`} className={progressClass} />
        <span className="shrink-0 text-xs font-semibold tabular-nums" data-testid="dashboard-goal-percent">{formatGoalPercent(progress.progressPercent, preferences)}</span>
      </div>}
    {progress.current !== null && <p className="mt-1 wrap-anywhere text-xs text-muted-foreground tabular-nums">
      {formatGoalValue(progress.current, goal, preferences.locale)} / {formatGoalValue(goal.target, goal, preferences.locale)}</p>}
  </li>;
}

function DomainCard({ domain, label, preferences }: { domain: DashboardDomain; label: string; preferences: UserPreferences }) {
  const { icon: Icon, tone } = domainPresentation[domain.key];
  const more = domain.activeCount - domain.goals.length;
  return <article aria-labelledby={`dashboard-${domain.key}-title`} data-testid={`dashboard-domain-${domain.key}`} className={`${card} flex flex-col`}>
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] ${tone}`}><Icon className="size-[18px]" strokeWidth={1.8} /></span>
        <h3 id={`dashboard-${domain.key}-title`} className="text-[17px] leading-6 font-semibold">{label}</h3>
      </div>
      {domain.activeCount > 0 && <span className="shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">{domain.activeCount} {plural(domain.activeCount, ["активная", "активные", "активных"])}</span>}
    </div>
    {domain.goals.length > 0
      ? <ul className="mt-5 grid gap-4">{domain.goals.map((value) => <GoalLine key={value.goal.id} value={value} preferences={preferences} />)}</ul>
      : <div className="mt-5 flex-1">
        <p className="text-sm font-semibold">Нет целей</p>
        <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">{domain.archivedCount > 0 ? "Активных целей нет, архив сохранён." : "Здесь появятся цели этой сферы и их прогресс по вашим измерениям."}</p>
        <Link href={`/goals/new?domain_key=${domain.key}`} className="action-link-secondary mt-4"><Plus aria-hidden="true" className="size-4" />Создать цель</Link>
      </div>}
    {(more > 0 || domain.activeCount + domain.archivedCount > 0) && <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-xs text-muted-foreground">
      <span>{more > 0 ? `Ещё ${more} ${plural(more, ["цель", "цели", "целей"])}` : domain.archivedCount > 0 ? `${domain.archivedCount} в архиве` : ""}</span>
      <Link href={`/goals?domain_key=${domain.key}${domain.activeCount === 0 ? "&status=archived" : ""}`} className="inline-flex min-h-8 items-center gap-1 rounded-full font-medium text-primary">
        Цели сферы <ArrowUpRight aria-hidden="true" className="size-3.5" /></Link>
    </div>}
  </article>;
}

const DUE_BADGES = {
  overdue: "border-st-red/40 bg-st-red/15 text-foreground",
  today: "border-today/40 bg-today/15 text-foreground",
  upcoming: "border-border bg-surface-2 text-muted-foreground",
} as const;

function TodayCard({ dashboard, labels, preferences, now }: { dashboard: Dashboard; labels: DomainLabels; preferences: UserPreferences; now: Date }) {
  const items = dashboard.today.dueGoals;
  return <section aria-labelledby="dashboard-today-title" className={card}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="dashboard-today-title" className="flex items-center gap-2 text-[17px] leading-6 font-semibold"><CalendarClock aria-hidden="true" className="size-[18px] text-today" />Сегодня</h2>
      <span className="text-xs text-muted-foreground">{formatDay(now, preferences)}</span>
    </div>
    {items.length === 0
      ? <p className="mt-4 text-[13px] leading-[18px] text-muted-foreground">Нет целей со сроком. Срок можно указать при создании или изменении цели.</p>
      : <ul className="mt-4 grid gap-2">{items.map(({ goal }) => {
        const state = dueState(goal.due_at!, now, preferences.timezone);
        return <li key={goal.id} className="min-w-0 rounded-[10px] border bg-surface-2 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${DUE_BADGES[state]}`}>{state === "overdue" ? "Просрочено" : state === "today" ? "Сегодня" : "Срок"}</span>
            <span className="text-xs text-muted-foreground"><time dateTime={goal.due_at!}>{formatDateTime(new Date(goal.due_at!), preferences)}</time> · {labels[goal.domain_key]}</span>
          </div>
          <Link href={`/goals/${goal.id}`} className="mt-1 block wrap-anywhere rounded text-sm font-semibold hover:underline underline-offset-4">{goal.title}</Link>
        </li>;
      })}</ul>}
    <p className="mt-4 text-xs text-muted-foreground">Активные цели со сроком, ближайшие первыми.</p>
  </section>;
}

function ActivityRow({ item, labels, preferences }: { item: DashboardActivity; labels: DomainLabels; preferences: UserPreferences }) {
  return <li className="min-w-0 border-b py-3 first:pt-0 last:border-b-0 last:pb-0" data-testid="dashboard-activity">
    <p className="text-sm">
      <span className="font-medium">{activityLabel(item.type)}</span>
      {item.measurement && <span className="font-semibold tabular-nums"> {formatGoalValue(item.measurement.value, { unit: item.measurement.unit, unit_label: item.measurement.unitLabel }, preferences.locale)}</span>}
    </p>
    <Link href={`/goals/${item.goal.id}`} className="mt-0.5 block wrap-anywhere rounded text-sm text-muted-foreground hover:text-foreground hover:underline underline-offset-4">{item.goal.title}</Link>
    <p className="mt-1 text-xs text-muted-foreground"><time dateTime={item.occurredAt}>{formatDateTime(new Date(item.occurredAt), preferences)}</time> · {labels[item.domainKey]} · {sourceLabel(item.source)}</p>
  </li>;
}

function ActivityCard({ dashboard, labels, preferences }: { dashboard: Dashboard; labels: DomainLabels; preferences: UserPreferences }) {
  return <section aria-labelledby="dashboard-activity-title" className={card}>
    <h2 id="dashboard-activity-title" className="flex items-center gap-2 text-[17px] leading-6 font-semibold"><History aria-hidden="true" className="size-[18px] text-primary" />Последние действия</h2>
    {dashboard.activity.length === 0
      ? <p className="mt-4 text-[13px] leading-[18px] text-muted-foreground">Действий пока нет. Здесь появятся созданные цели и измерения.</p>
      : <ol className="mt-4">{dashboard.activity.map((item) => <ActivityRow key={item.id} item={item} labels={labels} preferences={preferences} />)}</ol>}
  </section>;
}

function DashboardSkeleton() {
  return <div role="status" className="mt-6">
    <span className="sr-only">Загружаем обзор целей…</span>
    <div aria-hidden="true">
      <Skeleton className="h-5 w-72" />
      <div className="mt-8 grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"><Skeleton className="h-56 rounded-2xl" /><Skeleton className="h-56 rounded-2xl" /></div>
      <div className="mt-10 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-48 rounded-2xl" />)}</div>
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
    <div className="mt-8 grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <TodayCard dashboard={dashboard} labels={labels} preferences={preferences} now={now} />
      <ActivityCard dashboard={dashboard} labels={labels} preferences={preferences} />
    </div>
    <section aria-labelledby="dashboard-spheres-title" className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h2 id="dashboard-spheres-title" className="text-[17px] leading-6 font-semibold">Сферы жизни</h2>
        <p className="text-xs text-muted-foreground">Прогресс конкретных целей по вашим измерениям, не «уровень жизни»</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {dashboard.domains.map((domain) => <DomainCard key={domain.key} domain={domain} label={labels[domain.key]} preferences={preferences} />)}
      </div>
    </section>
  </>;
}
