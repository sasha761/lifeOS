"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, History, LayoutList, Plus } from "lucide-react";
import { dashboardSchema } from "@lifeos/contracts";
import type { Dashboard, DashboardActivity, DashboardDomain, DomainKey, GoalDetails, UserPreferences } from "@lifeos/contracts";
import { domainPresentation } from "../../lib/domain-presentation.ts";
import { activityLabel, dashboardTotals, dueState, focusFirst, formatDay, plural, sourceLabel } from "../../lib/dashboard-presentation.ts";
import { formatLoggedValue } from "../../lib/goal-presentation.ts";
import { closeStartDialog, startDialogClosed } from "../../lib/start-dialog-session.ts";
import { useDismiss } from "../../lib/use-dismiss.ts";
import { formatDate, formatDateTime } from "../../lib/user-preferences.ts";
import { ExampleChip, GoalAmount, GoalStatusChip, LoadState, useGoalData } from "../goals/shared.tsx";
import { ExamplesConfirm } from "../onboarding/examples-confirm.tsx";
import { StartDialog } from "../onboarding/start-dialog.tsx";
import type { ExampleGoalPreview } from "../onboarding/start-dialog.tsx";
import { ProgressBar } from "../ui/progress-bar.tsx";
import { SectionCard } from "../ui/section-card.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { SourceLabel } from "../ui/source-label.tsx";
import { StatusChip } from "../ui/status-chip.tsx";
import { ToneDot } from "../ui/tone-dot.tsx";

type DomainLabels = Record<DomainKey, string>;
const GOAL_FORMS = ["активная цель", "активные цели", "активных целей"] as const;
const COUNT_GOALS = ["цель", "цели", "целей"] as const;
const COUNT_MEASUREMENTS = ["измерение", "измерения", "измерений"] as const;
/** The right card of the first row stays about as tall as «Сегодня» (LFS-213); the API keeps its own limit. */
const DASHBOARD_ACTIVITY_SHOWN = 5;

/** Bold lead under the page title, as in mockup 04 («23 задачи за неделю. …»), counted from real goals only. */
function Summary({ dashboard }: { dashboard: Dashboard }) {
  const { active, archived, spheres } = dashboardTotals(dashboard);
  if (active === 0 && archived === 0) {
    return <p className="mt-2 text-sm leading-6 text-muted-foreground">Целей пока нет. Выберите сферу ниже и создайте первую цель — прогресс появится после первого измерения.</p>;
  }
  // Mockup 28: while every goal is an example, so is every measurement (an own value makes its goal the person's).
  const allExamples = dashboard.examples.goals > 0 && dashboard.examples.goals === active + archived;
  return <p className="mt-2 text-sm leading-6 text-muted-foreground" data-testid="dashboard-summary">
    <strong className="font-semibold text-foreground"><span className="tabular-nums">{active}</span> {plural(active, GOAL_FORMS)}
      {active > 0 && <> в <span className="tabular-nums">{spheres}</span> {plural(spheres, ["сфере", "сферах", "сферах"])}</>}.</strong>
    {archived > 0 && <> <span className="tabular-nums">{archived}</span> в архиве.</>}
    {allExamples && " Все цели и измерения пока примерные."}
  </p>;
}

/**
 * Newest active goal of the sphere: its bar and «X из Y · %», or why there is no percentage. A goal without measurements
 * (LFS-225) shows its status instead; there is never a sphere percentage.
 */
function SphereGoal({ value, preferences, examples }: { value: GoalDetails; preferences: UserPreferences; examples: boolean }) {
  const { goal, progress } = value;
  if (goal.kind === "unmeasured") return <p className="col-span-full flex justify-end sm:col-span-2" data-testid="dashboard-goal"><GoalStatusChip goal={goal} /></p>;
  return progress.progressPercent === null
    ? <p className="col-span-full text-xs leading-5 text-muted-foreground sm:col-span-2 sm:text-right" data-testid="dashboard-goal">{progress.explanation}</p>
    : <>
      <ProgressBar value={progress.progressPercent} tone={domainPresentation[goal.domain_key].tone} label={`Прогресс: ${goal.title}`}
        className={`col-span-full row-start-2 sm:col-span-1 sm:row-start-1 ${examples ? "sm:col-start-4" : "sm:col-start-3"}`} />
      <p className="min-w-0 text-right text-xs leading-5 text-muted-foreground" data-testid="dashboard-goal"><GoalAmount value={value} preferences={preferences} percentTestId="dashboard-goal-percent" /></p>
    </>;
}

/**
 * One row of «Сферы жизни» (mockup 04): colour dot, sphere name, bar and value of the newest active goal (LFS-213).
 * There is no sphere percentage or score: a sphere without measurements says so, an empty one offers a goal.
 */
function SphereRow({ domain, label, preferences, examples }: { domain: DashboardDomain; label: string; preferences: UserPreferences; examples: boolean }) {
  const [newest] = domain.goals;
  const more = domain.activeCount - (newest ? 1 : 0);
  const href = `/goals?domain_key=${domain.key}${domain.activeCount === 0 && domain.archivedCount > 0 ? "&status=archived" : ""}`;
  const example = newest?.goal.origin === "starter";
  // Mockup 28: while there are examples, «Пример» has its own column after the sphere name (rows stay aligned).
  return <li data-testid={`dashboard-domain-${domain.key}`}
    className={`grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5 py-2 sm:py-1.5 ${examples ? "sm:grid-cols-[auto_92px_64px_minmax(0,1fr)_210px]" : "sm:grid-cols-[auto_92px_minmax(0,1fr)_210px]"}`}>
    <ToneDot tone={domainPresentation[domain.key].tone} />
    <span className="flex min-w-0 items-center gap-1.5">
      <Link href={href} aria-label={newest ? `${label}: ${newest.goal.title}` : `${label}: цели сферы`} title={newest?.goal.title}
        className="rounded text-[13px] leading-5 font-semibold hover:underline underline-offset-4">{label}</Link>
      {more > 0 && newest && <span className="text-xs text-muted-foreground tabular-nums" title={`Ещё ${more} ${plural(more, ["цель", "цели", "целей"])}`}>+{more}</span>}
      {example && <ExampleChip className="sm:hidden" />}
    </span>
    {examples && <span className="hidden sm:block">{example && <ExampleChip />}</span>}
    {newest
      ? <SphereGoal value={newest} preferences={preferences} examples={examples} />
      : <p className="col-span-full flex flex-wrap items-center justify-end gap-x-2.5 text-xs leading-5 text-muted-foreground sm:col-span-2">
        {domain.archivedCount > 0 ? "Активных целей нет" : "Нет целей"}
        <Link href={`/goals/new?domain_key=${domain.key}`} className="inline-flex min-h-8 items-center gap-1 rounded font-medium text-primary pointer-coarse:min-h-11">
          <Plus aria-hidden="true" className="size-3.5" />Создать цель</Link>
      </p>}
  </li>;
}

/** «Сферы жизни» as the full-width block of bars in mockup 04: all six spheres, those in focus (LFS-219) first. */
function SpheresCard({ dashboard, labels, preferences }: { dashboard: Dashboard; labels: DomainLabels; preferences: UserPreferences }) {
  return <SectionCard titleId="dashboard-spheres-title" title="Сферы жизни" className="mt-4"
    description={<span className="sm:hidden">прогресс целей, не «уровень жизни»</span>}
    action={<span className="hidden text-xs font-normal text-muted-foreground sm:inline">прогресс целей, не «уровень жизни»</span>}>
    <ul className="grid divide-y sm:divide-y-0">{focusFirst(dashboard).map((domain) => <SphereRow key={domain.key} domain={domain} label={labels[domain.key]} preferences={preferences} examples={dashboard.examples.goals > 0} />)}</ul>
  </SectionCard>;
}

const DUE_TONES = { overdue: "red", today: "orange", upcoming: "outline" } as const;

function TodayCard({ dashboard, labels, preferences, now }: { dashboard: Dashboard; labels: DomainLabels; preferences: UserPreferences; now: Date }) {
  const items = dashboard.today.dueGoals;
  const empty = items.length === 0;
  // Mockup 28: without deadlines the card stretches to the row and shows a dashed empty block.
  return <SectionCard titleId="dashboard-today-title" title="Сегодня" icon={<CalendarClock aria-hidden="true" className="size-[18px] text-today" />}
    action={<span className="text-xs font-normal text-muted-foreground">{formatDay(now, preferences)}</span>}
    className={empty ? "lg:self-stretch" : undefined} contentClassName={empty ? "flex flex-1 flex-col" : undefined}>
    {empty
      ? <div data-testid="today-empty" className="flex min-h-28 flex-1 flex-col items-center justify-center gap-1.5 rounded-[14px] border-[1.5px] border-dashed border-border-strong p-[18px] text-center">
        <p className="text-xs leading-5 text-muted-foreground">Нет целей со сроком</p>
        <p className="text-[11px] leading-4 text-muted-foreground">{dashboard.examples.goals > 0
          ? "У примерных целей сроков нет. Добавьте срок, и цель появится здесь." : "Срок можно указать при создании или изменении цели."}</p>
      </div>
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
    {!empty && <p className="mt-3.5 text-xs text-muted-foreground">Активные цели со сроком, ближайшие первыми.</p>}
  </SectionCard>;
}

function ActivityRow({ item, labels, preferences }: { item: DashboardActivity; labels: DomainLabels; preferences: UserPreferences }) {
  return <li className="min-w-0 border-b py-2.5 first:pt-0 last:border-b-0 last:pb-0" data-testid="dashboard-activity">
    <p className="text-sm">
      <span className="font-medium">{activityLabel(item.type, item.phase, item.measurement?.contributionKind)}</span>
      {item.measurement && <span className="font-semibold tabular-nums"> {formatLoggedValue(item.measurement.value, item.measurement, preferences.locale)}</span>}
      {item.example && <> <ExampleChip className="ml-1 align-[1px]" /></>}
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

/**
 * Mockup 28: «Это пример» while the account has example goals, with «Пройти настройку вместо примера» (LFS-220) and
 * «Удалить все примеры». Each opens its confirmation card under the banner; Escape and a press outside close it and
 * return focus to the button that opened it. The replacement removes the examples and opens the questions.
 */
function ExamplesBanner({ dashboard, removed }: { dashboard: Dashboard; removed(deleted: number): void }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<"remove" | "replace" | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const removeToggle = useRef<HTMLButtonElement>(null);
  const replaceToggle = useRef<HTMLButtonElement>(null);
  const opener = confirming === "replace" ? replaceToggle : removeToggle;
  const close = useCallback(() => { setConfirming(null); opener.current?.focus(); }, [opener]);
  useDismiss(confirming !== null, close, box, opener);
  const { goals, measurements } = dashboard.examples;
  const marked = measurements > 0
    ? <><span className="tabular-nums">{goals}</span> {plural(goals, COUNT_GOALS)} и <span className="tabular-nums">{measurements}</span> {plural(measurements, COUNT_MEASUREMENTS)} помечены «Пример». Поправьте цель под себя: первое ваше измерение заменит примерное.</>
    : <><span className="tabular-nums">{goals}</span> {plural(goals, COUNT_GOALS)} {goals === 1 ? "помечена" : "помечены"} «Пример». Поправьте цель под себя.</>;
  return <div ref={box} className="relative mt-4" data-testid="examples-banner">
    <section aria-labelledby="examples-banner-title" className="flex flex-col gap-3 rounded-[14px] border border-primary/40 bg-primary/12 px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
        <span aria-hidden="true" className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-st-amber/20 text-st-amber"><LayoutList className="size-4" /></span>
        <div className="grid min-w-0 gap-1"><h2 id="examples-banner-title" className="text-sm font-bold">Это пример</h2>
          <p className="text-xs leading-5 text-muted-foreground">{marked} Или удалите всё и начните по-своему.</p></div>
      </div>
      <div className="flex flex-wrap gap-2.5 self-start sm:shrink-0 sm:self-auto">
        <button ref={replaceToggle} type="button" aria-expanded={confirming === "replace"} onClick={() => setConfirming((value) => value === "replace" ? null : "replace")}
          className="action-link-secondary action-compact border-border bg-transparent text-muted-foreground hover:text-foreground">Пройти настройку вместо примера</button>
        <button ref={removeToggle} type="button" aria-expanded={confirming === "remove"} onClick={() => setConfirming((value) => value === "remove" ? null : "remove")}
          className="action-link-secondary action-compact border-destructive/55 bg-transparent text-destructive hover:bg-destructive/10">Удалить все примеры</button>
      </div>
    </section>
    {confirming && <ExamplesConfirm key={confirming} kind={confirming} count={goals} close={close} className="absolute top-[calc(100%+8px)] right-0 sm:top-[calc(100%-18px)]"
      done={(deleted) => {
        setConfirming(null);
        // The questions start right away; the dashboard is reloaded when the person returns.
        if (confirming === "replace") router.push("/onboarding"); else removed(deleted);
      }} />}
  </div>;
}

/** Mockup 28, under «Сферы жизни»: what the chip means. */
function ExamplesLegend() {
  return <p className="mt-3 text-xs leading-5 text-muted-foreground"><ExampleChip className="mr-2 align-[1px]" />
    помечает цели и измерения из стартового набора. Ваши собственные измерения этой метки не получают.</p>;
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

/**
 * Client part of /dashboard: reads GET /api/v1/dashboard with loading, error/retry and empty states. The first-visit popup
 * (LFS-220) comes with the same data (`onboarding.show_start`); only «✕» is remembered in the browser session.
 */
export function DashboardView({ preferences, labels, examples }: { preferences: UserPreferences; labels: DomainLabels; examples: readonly ExampleGoalPreview[] }) {
  const resource = useGoalData("/api/v1/dashboard", dashboardSchema);
  const [now] = useState(() => new Date());
  const [message, setMessage] = useState<string | null>(null);
  // Hidden right after a choice or «✕»; the reloaded data decide from then on.
  const [startHidden, setStartHidden] = useState(false);
  const status = useRef<HTMLDivElement>(null);
  // The banner and its button are gone after «Удалить все примеры»: focus moves to the result once it is rendered.
  useEffect(() => { if (message) status.current?.focus(); }, [message]);
  if (resource.error) return <LoadState loading={false} error={resource.error} retry={resource.reload} />;
  if (!resource.data) return <DashboardSkeleton />;
  const dashboard = resource.data;
  // Rendered only in the browser: the data are fetched there, so the session flag never meets the server render.
  const showStart = dashboard.onboarding.show_start && !startHidden && !startDialogClosed();
  function removed(deleted: number) {
    setMessage(`Примеры удалены: ${deleted} ${plural(deleted, COUNT_GOALS)}. Цели, которые вы сделали своими, остались.`);
    resource.reload();
  }
  function chosen() {
    setStartHidden(true);
    resource.reload();
  }
  return <>
    {showStart && <StartDialog mode="first" status={dashboard.onboarding.status} goals={0} exampleGoals={dashboard.examples.goals} focus={[]} hasDraft={false}
      examples={examples} close={() => { closeStartDialog(); setStartHidden(true); }} loaded={chosen} dismissed={chosen} />}
    <Summary dashboard={dashboard} />
    {message && <div ref={status} role="status" tabIndex={-1} className="mt-4 rounded-[10px] border border-st-green/40 bg-st-green/10 px-3 py-2.5 text-sm">{message}</div>}
    {dashboard.examples.goals > 0 && <ExamplesBanner dashboard={dashboard} removed={removed} />}
    <div className="mt-4 grid items-start gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
      <TodayCard dashboard={dashboard} labels={labels} preferences={preferences} now={now} />
      <ActivityCard dashboard={dashboard} labels={labels} preferences={preferences} />
    </div>
    <SpheresCard dashboard={dashboard} labels={labels} preferences={preferences} />
    {(dashboard.examples.goals > 0 || dashboard.examples.measurements > 0) && <ExamplesLegend />}
  </>;
}
