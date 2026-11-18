"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, Plus, Target } from "lucide-react";
import { dashboardSchema, domainKeySchema, goalStatusSchema, goalsPageSchema } from "@lifeos/contracts";
import type { DomainKey, GoalDetails, GoalsPage, UserPreferences } from "@lifeos/contracts";
import { dashboardTotals, plural } from "../../lib/dashboard-presentation.ts";
import { getGoalsData, GoalRequestError } from "../../lib/goals-api-client.ts";
import { domainPresentation } from "../../lib/domain-presentation.ts";
import { formatDate } from "../../lib/user-preferences.ts";
import { FormAlert } from "../auth/form-parts.tsx";
import { Card } from "../ui/card.tsx";
import { DomainIcon } from "../ui/domain-icon.tsx";
import { PageHeader } from "../ui/page-header.tsx";
import { ProgressBar } from "../ui/progress-bar.tsx";
import { SegmentedTabs } from "../ui/segmented-tabs.tsx";
import { SourceLabel } from "../ui/source-label.tsx";
import { StatusChip } from "../ui/status-chip.tsx";
import { GoalPanel } from "./goal-detail.tsx";
import { GoalAmount, LoadState, StatusBadge, useGoalData } from "./shared.tsx";
import type { DomainChoice } from "./shared.tsx";

type Browser = { preferences: UserPreferences; domains: DomainChoice[]; firstId: string | null; filters: string; reloadList(): void };
const BrowserContext = createContext<Browser | null>(null);
const GOAL_FORMS = ["активная цель", "активные цели", "активных целей"] as const;

/** One goal as a row card from mockup 09; the title links to `/goals/[id]` with the current filters, the chosen one is highlighted. */
function GoalRow({ value, label, preferences, href, selected }: { value: GoalDetails; label: string; preferences: UserPreferences; href: string; selected: boolean }) {
  const { goal, progress } = value;
  const tone = domainPresentation[goal.domain_key].tone;
  return <Card size="sm" data-selected={selected || undefined} className={`min-w-0 flex-row items-start gap-3.5 rounded-xl px-3.5 [--card-spacing:--spacing(3)] ${selected ? "bg-primary/6 ring-primary" : ""}`}>
    <DomainIcon domain={goal.domain_key} />
    <div className="grid min-w-0 flex-1 gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
        <p className="min-w-0 text-sm leading-5 font-bold wrap-anywhere"><Link href={href} scroll={false} aria-current={selected ? "true" : undefined} className="rounded hover:underline underline-offset-4">{goal.title}</Link></p>
        <StatusChip tone={tone}>{label}</StatusChip>
        {goal.status === "archived" && <StatusBadge status={goal.status} />}
        {goal.due_at && <span className="ml-auto text-xs leading-5 text-muted-foreground tabular-nums">до <time dateTime={goal.due_at}>{formatDate(new Date(goal.due_at), preferences)}</time></span>}
      </div>
      {progress.progressPercent !== null && <ProgressBar value={progress.progressPercent} tone={tone} label={`Прогресс: ${goal.title}`} />}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
        {progress.current === null
          ? <><span className="text-xs leading-5 text-muted-foreground">Нет измерений, поэтому процент не показываем.</span>
            {goal.status === "active" && <Link href={href} scroll={false} className="action-link-secondary action-sm ml-auto"><Plus aria-hidden="true" className="size-3.5" />Первое измерение</Link>}</>
          : <><GoalAmount value={value} preferences={preferences} />
            <SourceLabel className="ml-auto">ручной ввод{progress.provenance && <> · <time dateTime={progress.provenance.measuredAt}>{formatDate(new Date(progress.provenance.measuredAt), preferences)}</time></>}</SourceLabel></>}
      </div>
    </div>
  </Card>;
}

/**
 * /goals and /goals/[id] (mockup 09, LFS-213): header with real counts, filters, the list and — from 1024px — the panel
 * of the chosen goal beside it. It lives in the route layout, so choosing a goal keeps the list, its pages and the
 * focused link. Without an id the first goal of the list is shown; on narrow screens the list and the goal are
 * separate screens.
 */
export function GoalsBrowser({ preferences, domains, children }: { preferences: UserPreferences; domains: DomainChoice[]; children: ReactNode }) {
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
  // Exact counts from the Dashboard read model (no extra API); with a sphere filter, that sphere's counts.
  const totals = counts.data ? dashboardTotals(counts.data) : null;
  const sphere = counts.data && domainKey ? counts.data.domains.find((value) => value.key === domainKey) : undefined;
  const activeCount = sphere ? sphere.activeCount : totals?.active;
  const archivedCount = sphere ? sphere.archivedCount : totals?.archived;
  const lead = totals && totals.active > 0
    ? <><strong className="font-semibold text-foreground"><span className="tabular-nums">{totals.active}</span> {plural(totals.active, GOAL_FORMS)} в <span className="tabular-nums">{totals.spheres}</span> {plural(totals.spheres, ["сфере", "сферах", "сферах"])}.</strong>{" "}</>
    : null;

  return <BrowserContext.Provider value={{ preferences, domains, firstId, filters: filterSuffix, reloadList }}>
    <div className={selectedId ? "max-lg:hidden" : undefined}>
      <PageHeader title="Цели" description={<>{lead}Прогресс считается только по измерениям, у каждой цели виден источник.</>}
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
      <section aria-label="Список целей" className={`min-w-0 ${selectedId ? "max-lg:hidden" : ""}`}>
        <LoadState loading={resource.loading} error={resource.error} retry={reloadList} />
        {loaded && <>
          {!items.length ? <div className="rounded-2xl border border-dashed border-border-strong px-5 py-12 text-center">
            <Target aria-hidden="true" className="mx-auto mb-4 size-8 text-primary" /><h2 className="text-xl font-semibold">Целей пока нет</h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">{status === "archived" ? "Здесь появятся архивные цели. Их измерения и история сохранятся." : "Начните с одной цели. Первое измерение покажет, где вы сейчас, без выдуманных процентов."}</p>
            <Link href={createUrl} className="action-link action-compact mt-6">Создать цель</Link></div>
            : <ul className="grid gap-2.5">{items.map((value) => <li key={value.goal.id}>
              <GoalRow value={value} label={labelOf(value.goal.domain_key)} preferences={preferences} href={`/goals/${value.goal.id}${filterSuffix}`} selected={value.goal.id === shown} /></li>)}</ul>}
          {error && <div className="mt-5"><FormAlert tone="error">{error}</FormAlert></div>}
          {data.nextCursor && <button onClick={loadMore} disabled={pending} className="action-link-secondary action-compact mt-5 disabled:opacity-50">{pending ? "Загружаем…" : "Показать ещё цели"}</button>}
        </>}
      </section>
      {children}
    </div>
  </BrowserContext.Provider>;
}

/**
 * The page part of /goals and /goals/[id]: the panel of the given goal, or of the first goal in the list (shown beside
 * the list from 1024px only). Outside the browser layout (no session) it renders nothing; the page redirects.
 */
export function SelectedGoal({ id }: { id?: string }) {
  const browser = useContext(BrowserContext);
  const target = id?.toLowerCase() ?? browser?.firstId;
  if (!browser || !target) return null;
  return <div className={`min-w-0 lg:sticky lg:top-4 ${id ? "" : "max-lg:hidden"}`}>
    <GoalPanel key={target} id={target} preferences={browser.preferences} domains={browser.domains} onChanged={browser.reloadList} />
  </div>;
}
