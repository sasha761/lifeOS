"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, Plus, Target, Trash2 } from "lucide-react";
import { dashboardSchema, domainKeySchema, goalStatusSchema, goalsPageSchema } from "@lifeos/contracts";
import type { DomainKey, GoalDetails, GoalsPage, UserPreferences } from "@lifeos/contracts";
import { dashboardTotals, plural } from "../../lib/dashboard-presentation.ts";
import { getGoalsData, GoalRequestError } from "../../lib/goals-api-client.ts";
import { domainPresentation } from "../../lib/domain-presentation.ts";
import { formatGoalPercent, formatProgressAmount } from "../../lib/goal-presentation.ts";
import { formatDate } from "../../lib/user-preferences.ts";
import { FormAlert } from "../auth/form-parts.tsx";
import { Card } from "../ui/card.tsx";
import { DomainIcon } from "../ui/domain-icon.tsx";
import { PageHeader } from "../ui/page-header.tsx";
import { ProgressBar } from "../ui/progress-bar.tsx";
import { SegmentedTabs } from "../ui/segmented-tabs.tsx";
import { DeleteGoalDialog, GoalPanel } from "./goal-detail.tsx";
import { ExampleChip, GoalStatusChip, LoadState, useGoalData } from "./shared.tsx";
import type { DomainChoice } from "./shared.tsx";

type Browser = { preferences: UserPreferences; domains: DomainChoice[]; firstId: string | null; filters: string; deletedId: string | null; reloadList(): void; deleted(id: string): void };
const BrowserContext = createContext<Browser | null>(null);
const GOAL_FORMS = ["активная цель", "активные цели", "активных целей"] as const;

/**
 * One goal as a row card of mockup 32 (LFS-224, LFS-225): sphere square, title, «сфера · с <начало> · до <срок>» (an
 * achieved goal: «сфера · отмечена <дата>»); on the right the bar, the percentage and «X из Y» (or «Нет данных»), for a
 * goal without measurements its status chip. A numeric goal that is not «В процессе» shows its status by the title. The title is a link stretched over the whole card, so a click anywhere opens
 * the goal; «Удалить» is a separate button above it — no control is nested in the link. With a mouse on a wide screen
 * the button shows on hover and on focus inside the row; on touch screens and below 1024px it is always visible (40px).
 */
export function GoalRow({ value, label, preferences, href, selected, onDelete }: {
  value: GoalDetails; label: string; preferences: UserPreferences; href: string;
  /** `wide`: the first goal shown by default — its panel is beside the list only from 1024px, so is the highlight. */
  selected: boolean | "wide"; onDelete(): void;
}) {
  const { goal, progress } = value;
  const tone = domainPresentation[goal.domain_key].tone;
  const active = goal.status === "active";
  const day = (instant: string) => <time dateTime={instant}>{formatDate(new Date(instant), preferences)}</time>;
  const when = active && goal.phase === "achieved" ? <> · отмечена {day(goal.phase_changed_at)}</>
    : <>{goal.starts_at && <> · с {day(goal.starts_at)}</>}{goal.due_at && <> · до {day(goal.due_at)}</>}</>;
  const look = selected === true ? "bg-primary/6 ring-primary" : selected === "wide"
    ? "hover:bg-surface-2 hover:ring-border-strong lg:bg-primary/6 lg:ring-primary lg:hover:bg-primary/6 lg:hover:ring-primary" : "hover:bg-surface-2 hover:ring-border-strong";
  return <Card size="sm" data-testid="goal-row" data-selected={selected || undefined}
    className={`group/row relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-2.5 rounded-xl px-3.5 transition-colors duration-[120ms] [--card-spacing:--spacing(3)] has-[[data-goal-link]:focus-visible]:outline-2 has-[[data-goal-link]:focus-visible]:outline-offset-2 has-[[data-goal-link]:focus-visible]:outline-ring md:grid-cols-[auto_minmax(0,1fr)_220px_auto] ${look}`}>
    <DomainIcon domain={goal.domain_key} className="self-start md:self-center" />
    <div className="grid min-w-0 gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Link data-goal-link={goal.id} href={href} scroll={false} aria-current={selected ? "true" : undefined}
          className="min-w-0 rounded text-sm leading-5 font-bold wrap-anywhere after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none">{goal.title}</Link>
        {(!active || (goal.kind === "numeric" && goal.phase !== "in_progress")) && <GoalStatusChip goal={goal} />}
        {goal.origin === "starter" && <ExampleChip />}
      </div>
      <p className="text-xs leading-4 text-muted-foreground tabular-nums">{label}{when}</p>
    </div>
    <div className="col-start-2 grid min-w-0 gap-1 md:col-start-3 md:row-start-1" data-testid="goal-row-progress">
      {goal.kind === "unmeasured"
        ? <div className="justify-self-start"><GoalStatusChip goal={{ status: "active", phase: goal.phase }} /></div>
        : progress.current === null
        ? <><span className="text-xs leading-4 text-muted-foreground">Нет данных</span>
          {goal.status === "active" && <span className="text-[11px] leading-4 text-muted-foreground max-md:hidden">добавьте первое измерение</span>}</>
        : <>{progress.progressPercent !== null && <div className="flex items-center gap-2">
          <ProgressBar value={progress.progressPercent} tone={tone} label={`Прогресс: ${goal.title}`} className="flex-1" />
          <span className="text-xs leading-4 font-bold tabular-nums">{formatGoalPercent(progress.progressPercent, preferences)}</span></div>}
          <span className="text-[11px] leading-4 text-muted-foreground wrap-anywhere tabular-nums">{formatProgressAmount(goal, progress, preferences.locale)}</span></>}
    </div>
    <button type="button" onClick={onDelete} aria-label={`Удалить цель «${goal.title}»`} title="Удалить цель"
      className="relative z-10 col-start-3 row-start-1 inline-flex size-10 items-center justify-center self-start rounded-full border border-transparent text-muted-foreground transition-[color,background-color,border-color,opacity] duration-[120ms] hover:border-destructive/55 hover:bg-destructive/15 hover:text-destructive md:col-start-4 md:self-center lg:pointer-fine:size-8 lg:pointer-fine:opacity-0 lg:pointer-fine:group-hover/row:opacity-100 lg:pointer-fine:group-focus-within/row:opacity-100">
      <Trash2 aria-hidden="true" className="size-[15px]" /></button>
  </Card>;
}

/**
 * /goals and /goals/[id] (mockup 09, LFS-213): header with real counts, filters, the list and — from 1024px — the panel
 * of the chosen goal beside it. It lives in the route layout, so choosing a goal keeps the list, its pages and the
 * focused link. Without an id the first goal of the list is shown; on narrow screens the list and the goal are
 * separate screens.
 */
export function GoalsBrowser({ preferences, domains, children }: { preferences: UserPreferences; domains: DomainChoice[]; children: ReactNode }) {
  const router = useRouter();
  const [deletedId, setDeletedId] = useState<string | null>(null);
  const search = useSearchParams();
  const params = useParams<{ id?: string }>();
  const selectedId = typeof params.id === "string" ? params.id.toLowerCase() : null;
  const domainKey = domainKeySchema.safeParse(search.get("domain_key")).data;
  // No `status` means active goals; any other value that is not a status shows all of them.
  const parsedStatus = goalStatusSchema.safeParse(search.get("status") ?? "active");
  const status = parsedStatus.success ? parsedStatus.data : undefined;
  const query = new URLSearchParams({ limit: "20" });
  if (domainKey) query.set("domain_key", domainKey);
  if (status) query.set("status", status);
  const url = `/api/v1/goals?${query}`;
  const filters = new URLSearchParams();
  if (domainKey) filters.set("domain_key", domainKey);
  if (search.get("status") !== null) filters.set("status", status ?? "all");
  const filterSuffix = filters.size ? `?${filters}` : "";

  const resource = useGoalData(url, goalsPageSchema);
  const counts = useGoalData("/api/v1/dashboard", dashboardSchema);
  const [more, setMore] = useState<{ url: string; page: GoalsPage } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = more?.url === url ? more.page : resource.data;
  // «Удалить» on a row (LFS-224): the goal whose confirmation is open; after a deletion, the row to focus.
  const [removing, setRemoving] = useState<string | null>(null);
  const focusAfter = useRef<string | null>(null);
  const list = useRef<HTMLElement>(null);
  function reloadList() { setMore(null); resource.reload(); counts.reload(); }
  async function loadMore() {
    if (pending || !data?.nextCursor) return;
    setPending(true); setError(null);
    try {
      const page = await getGoalsData(`${url}&cursor=${encodeURIComponent(data.nextCursor)}`, goalsPageSchema);
      setMore({ url, page: { ...page, items: [...new Map([...data.items, ...page.items].map((item) => [item.goal.id, item])).values()] } });
    } catch (error) { setError(error instanceof GoalRequestError ? error.message : "Не удалось загрузить следующую страницу."); }
    finally { setPending(false); }
  }

  const createUrl = `/goals/new${domainKey ? `?domain_key=${domainKey}` : ""}`;
  // Every filter is a link; the other filter is kept.
  const href = (next: { domain?: DomainKey | null; status?: "active" | "archived" | "all" }) => {
    const params = new URLSearchParams();
    const domain = next.domain === undefined ? domainKey : next.domain;
    const view = next.status ?? (status ?? "all");
    if (domain) params.set("domain_key", domain);
    if (view !== "active") params.set("status", view);
    return `/goals${params.size ? `?${params}` : ""}`;
  };
  const labelOf = (key: DomainKey) => domains.find((domain) => domain.key === key)?.label ?? key;
  const loaded = data && !resource.error && !resource.loading;
  const items = loaded ? data.items : [];
  const firstId = items[0]?.goal.id ?? null;
  const shown = selectedId ?? firstId;
  /**
   * After a deletion (from a row or from the panel) the list and the counters are read again. The deleted goal, when it
   * was the open one, gives way to the first goal of the list; focus goes to the next row (or the previous, or the list).
   */
  function deleted(id: string) {
    const index = items.findIndex((value) => value.goal.id === id);
    focusAfter.current = items[index + 1]?.goal.id ?? items[index - 1]?.goal.id ?? "list";
    setDeletedId(id); reloadList();
    if (selectedId === id) router.replace(`/goals${filterSuffix}`);
    // Refresh server-rendered route data; reloadList also refetches the Dashboard counters.
    router.refresh();
  }
  // Focus moves once the reloaded list no longer has the deleted goal and is on screen (not behind /goals/[id] on a phone).
  useEffect(() => {
    const target = focusAfter.current;
    if (!target || !loaded || selectedId === deletedId || items.some((value) => value.goal.id === deletedId)) return;
    focusAfter.current = null;
    (list.current?.querySelector<HTMLElement>(`[data-goal-link="${target}"]`) ?? list.current)?.focus();
  }, [loaded, items, selectedId, deletedId]);
  // Exact counts from the Dashboard read model (no extra API); with a sphere filter, that sphere's counts.
  const totals = counts.data ? dashboardTotals(counts.data) : null;
  const sphere = counts.data && domainKey ? counts.data.domains.find((value) => value.key === domainKey) : undefined;
  const activeCount = sphere ? sphere.activeCount : totals?.active;
  const archivedCount = sphere ? sphere.archivedCount : totals?.archived;
  const lead = totals && totals.active > 0
    ? <><strong className="font-semibold text-foreground"><span className="tabular-nums">{totals.active}</span> {plural(totals.active, GOAL_FORMS)} в <span className="tabular-nums">{totals.spheres}</span> {plural(totals.spheres, ["сфере", "сферах", "сферах"])}.</strong>{" "}</>
    : null;

  return <BrowserContext.Provider value={{ preferences, domains, firstId, filters: filterSuffix, deletedId, reloadList, deleted }}>
    {deletedId && <div role="status" className="mb-4 rounded-lg border border-st-green/40 bg-st-green/10 px-3 py-2.5 text-sm">Цель удалена</div>}
    <div className={selectedId ? "max-lg:hidden" : undefined}>
      <PageHeader title="Цели" description={<>{lead}Процент — только по вашим измерениям.</>}
        actions={<>
          <SegmentedTabs size="sm" label="Статус целей" items={[
            { href: href({ status: "active" }), label: "Активные", active: status === "active", count: activeCount },
            { href: href({ status: "archived" }), label: "В архиве", active: status === "archived", count: archivedCount },
            { href: href({ status: "all" }), label: "Все", active: status === undefined },
          ]} />
          <Link href={createUrl} aria-label="Новая цель" className="action-link action-compact"><Plus aria-hidden="true" className="size-4" />Цель</Link>
        </>} />
      <SegmentedTabs size="sm" label="Сфера целей" className="mt-4" items={[
        { href: href({ domain: null }), label: "Все сферы", active: domainKey === undefined },
        ...domains.map((domain) => ({ href: href({ domain: domain.key }), label: domain.label, active: domainKey === domain.key })),
      ]} />
    </div>
    {selectedId && <Link href={`/goals${filterSuffix}`} className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-full pr-3 text-sm text-muted-foreground transition-colors duration-[120ms] hover:text-foreground lg:hidden">
      <ArrowLeft aria-hidden="true" className="size-4" />Все цели</Link>}
    <div className={`grid items-start gap-4 lg:mt-4 ${shown ? "lg:grid-cols-[minmax(0,1fr)_440px]" : ""} ${selectedId ? "" : "mt-4"}`}>
      <section ref={list} tabIndex={-1} aria-label="Список целей" className={`min-w-0 rounded-xl ${selectedId ? "max-lg:hidden" : ""}`}>
        <LoadState loading={resource.loading} error={resource.error} retry={reloadList} />
        {loaded && <>
          {!items.length ? <div className="rounded-2xl border border-dashed border-border-strong px-5 py-12 text-center">
            <Target aria-hidden="true" className="mx-auto mb-4 size-8 text-primary" /><h2 className="text-xl font-semibold">Целей пока нет</h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">{status === "archived" ? "Здесь появятся архивные цели. Их измерения и история сохранятся." : "Начните с одной цели. Первое измерение покажет, где вы сейчас, без выдуманных процентов."}</p>
            <Link href={createUrl} className="action-link action-compact mt-6">Создать цель</Link></div>
            : <ul className="grid gap-2">{items.map((value) => <li key={value.goal.id}>
              <GoalRow value={value} label={labelOf(value.goal.domain_key)} preferences={preferences} href={`/goals/${value.goal.id}${filterSuffix}`} selected={value.goal.id === shown && (selectedId ? true : "wide")}
                onDelete={() => setRemoving(value.goal.id)} /></li>)}</ul>}
          {error && <div className="mt-5"><FormAlert tone="error">{error}</FormAlert></div>}
          {data.nextCursor && <button onClick={loadMore} disabled={pending} className="action-link-secondary action-compact mt-5 disabled:opacity-50">{pending ? "Загружаем…" : "Показать ещё цели"}</button>}
        </>}
      </section>
      {children}
    </div>
    {removing && <DeleteGoalDialog id={removing} close={() => setRemoving(null)} onDeleted={() => { setRemoving(null); deleted(removing); }} />}
  </BrowserContext.Provider>;
}

/**
 * The page part of /goals and /goals/[id]: the panel of the given goal, or of the first goal in the list (shown beside
 * the list from 1024px only). Outside the browser layout (no session) it renders nothing; the page redirects.
 */
export function SelectedGoal({ id }: { id?: string }) {
  const browser = useContext(BrowserContext);
  const target = id?.toLowerCase() ?? browser?.firstId;
  if (!browser || !target || browser.deletedId === target) return null;
  return <div className={`min-w-0 lg:sticky lg:top-4 ${id ? "" : "max-lg:hidden"}`}>
    <GoalPanel key={target} id={target} preferences={browser.preferences} domains={browser.domains} onChanged={browser.reloadList} onDeleted={() => browser.deleted(target)} />
  </div>;
}
