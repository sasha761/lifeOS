"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Target } from "lucide-react";
import { goalsPageSchema } from "@lifeos/contracts";
import type { DomainKey, GoalDetails, GoalsPage, UserPreferences } from "@lifeos/contracts";
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
import { GoalAmount, LoadState, StatusBadge, useGoalData } from "./shared.tsx";
import type { DomainChoice } from "./shared.tsx";

/** One goal as a row card from mockup 09: sphere icon, title, sphere chip, deadline, bar, «value of target · %», source. */
function GoalRow({ value, label, preferences }: { value: GoalDetails; label: string; preferences: UserPreferences }) {
  const { goal, progress } = value;
  const tone = domainPresentation[goal.domain_key].tone;
  return <Card size="sm" className="min-w-0 flex-row items-start gap-3.5 rounded-xl px-3.5 [--card-spacing:--spacing(3)]">
    <DomainIcon domain={goal.domain_key} />
    <div className="grid min-w-0 flex-1 gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
        <h2 className="min-w-0 text-sm leading-5 font-bold wrap-anywhere"><Link href={`/goals/${goal.id}`} className="rounded hover:underline underline-offset-4">{goal.title}</Link></h2>
        <StatusChip tone={tone}>{label}</StatusChip>
        {goal.status === "archived" && <StatusBadge status={goal.status} />}
        {goal.due_at && <span className="ml-auto text-xs leading-5 text-muted-foreground tabular-nums">до <time dateTime={goal.due_at}>{formatDate(new Date(goal.due_at), preferences)}</time></span>}
      </div>
      {progress.progressPercent !== null && <ProgressBar value={progress.progressPercent} tone={tone} label={`Прогресс: ${goal.title}`} />}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
        {progress.current === null
          ? <><span className="text-xs leading-5 text-muted-foreground">Нет измерений, поэтому процент не показываем.</span>
            {goal.status === "active" && <Link href={`/goals/${goal.id}`} className="action-link-secondary action-sm ml-auto"><Plus aria-hidden="true" className="size-3.5" />Первое измерение</Link>}</>
          : <><GoalAmount value={value} preferences={preferences} />
            <SourceLabel className="ml-auto">ручной ввод{progress.provenance && <> · <time dateTime={progress.provenance.measuredAt}>{formatDate(new Date(progress.provenance.measuredAt), preferences)}</time></>}</SourceLabel></>}
      </div>
    </div>
  </Card>;
}

export function GoalsList({ preferences, domains, domainKey, status }: { preferences: UserPreferences; domains: DomainChoice[]; domainKey?: DomainKey; status?: "active" | "archived" }) {
  const query = new URLSearchParams({ limit: "20" });
  if (domainKey) query.set("domain_key", domainKey);
  if (status) query.set("status", status);
  const url = `/api/v1/goals?${query}`;
  const resource = useGoalData(url, goalsPageSchema);
  const [more, setMore] = useState<GoalsPage | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = more ?? resource.data;
  async function loadMore() {
    if (pending || !data?.nextCursor) return;
    setPending(true); setError(null);
    try {
      const page = await getGoalsData(`${url}&cursor=${encodeURIComponent(data.nextCursor)}`, goalsPageSchema);
      setMore({ ...page, items: [...new Map([...data.items, ...page.items].map((item) => [item.goal.id, item])).values()] });
    } catch (error) { setError(error instanceof GoalRequestError ? error.message : "Не удалось загрузить следующую страницу."); }
    finally { setPending(false); }
  }
  const createUrl = `/goals/new${domainKey ? `?domain_key=${domainKey}` : ""}`;
  // Every filter is a link; no `status` parameter means active goals (see goals/page.tsx) and the other filter is kept.
  const href = (next: { domain?: DomainKey | null; status?: "active" | "archived" | "all" }) => {
    const params = new URLSearchParams();
    const domain = next.domain === undefined ? domainKey : next.domain;
    const view = next.status ?? (status ?? "all");
    if (domain) params.set("domain_key", domain);
    if (view !== "active") params.set("status", view);
    return `/goals${params.size ? `?${params}` : ""}`;
  };
  const labelOf = (key: DomainKey) => domains.find((domain) => domain.key === key)?.label ?? key;
  return <>
    <PageHeader title="Цели" description="Прогресс считается только по измерениям, у каждой цели виден источник."
      actions={<>
        <SegmentedTabs size="sm" label="Статус целей" items={[
          { href: href({ status: "active" }), label: "Активные", active: status === "active" },
          { href: href({ status: "archived" }), label: "В архиве", active: status === "archived" },
          { href: href({ status: "all" }), label: "Все", active: status === undefined },
        ]} />
        <Link href={createUrl} aria-label="Новая цель" className="action-link action-compact"><Plus aria-hidden="true" className="size-4" />Цель</Link>
      </>} />
    <SegmentedTabs size="sm" label="Сфера целей" className="mt-4" items={[
      { href: href({ domain: null }), label: "Все сферы", active: domainKey === undefined },
      ...domains.map((domain) => ({ href: href({ domain: domain.key }), label: domain.label, active: domainKey === domain.key })),
    ]} />
    <LoadState loading={resource.loading} error={resource.error} retry={() => { setMore(null); resource.reload(); }} />
    {data && !resource.error && !resource.loading && <>
      {!data.items.length ? <section className="mt-4 rounded-2xl border border-dashed border-border-strong px-5 py-12 text-center" aria-labelledby="goals-empty-title">
        <Target aria-hidden="true" className="mx-auto mb-4 size-8 text-primary" /><h2 id="goals-empty-title" className="text-xl font-semibold">Целей пока нет</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">{status === "archived" ? "Здесь появятся архивные цели. Их измерения и история сохранятся." : "Начните с одной цели. Первое измерение покажет, где вы сейчас, без выдуманных процентов."}</p>
        <Link href={createUrl} className="action-link action-compact mt-6">Создать цель</Link></section>
        : <ul className="mt-4 grid gap-2.5">{data.items.map((value) => <li key={value.goal.id}><GoalRow value={value} label={labelOf(value.goal.domain_key)} preferences={preferences} /></li>)}</ul>}
      {error && <div className="mt-5"><FormAlert tone="error">{error}</FormAlert></div>}
      {data.nextCursor && <button onClick={loadMore} disabled={pending} className="action-link-secondary action-compact mt-5 disabled:opacity-50">{pending ? "Загружаем…" : "Показать ещё цели"}</button>}
    </>}
  </>;
}
