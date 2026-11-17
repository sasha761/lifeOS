"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Target } from "lucide-react";
import { goalsPageSchema } from "@lifeos/contracts";
import type { DomainKey, GoalsPage, UserPreferences } from "@lifeos/contracts";
import { getGoalsData, GoalRequestError } from "../../lib/goals-api-client.ts";
import { formatDateTime } from "../../lib/user-preferences.ts";
import { FormAlert } from "../auth/form-parts.tsx";
import { GoalProgressView, inputClass, LoadState, StatusBadge, useGoalData } from "./shared.tsx";
import type { DomainChoice } from "./shared.tsx";

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
  return <>
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-muted-foreground">Ваши ориентиры</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Цели</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">Одна цель, понятное направление и реальные измерения. Выберите сферу, в которой хотите двигаться дальше.</p></div>
      <Link href={createUrl} className="action-link"><Plus aria-hidden="true" className="size-4" />Новая цель</Link></div>
    <form action="/goals" method="get" aria-label="Фильтры целей" className="mt-8 grid gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <div><label htmlFor="filter-domain" className="mb-2 block text-sm font-medium">Сфера</label><select id="filter-domain" name="domain_key" defaultValue={domainKey ?? ""} className={inputClass}>
        <option value="">Все сферы</option>{domains.map((domain) => <option key={domain.key} value={domain.key}>{domain.label}</option>)}</select></div>
      <div><label htmlFor="filter-status" className="mb-2 block text-sm font-medium">Статус</label><select id="filter-status" name="status" defaultValue={status ?? "all"} className={inputClass}>
        <option value="active">Активные</option><option value="archived">В архиве</option><option value="all">Все статусы</option></select></div>
      <button className="action-link-secondary" type="submit">Показать</button></form>
    <LoadState loading={resource.loading} error={resource.error} retry={() => { setMore(null); resource.reload(); }} />
    {data && !resource.error && !resource.loading && <>
      {!data.items.length ? <section className="mt-6 rounded-2xl border border-dashed px-5 py-12 text-center" aria-labelledby="goals-empty-title">
        <Target aria-hidden="true" className="mx-auto mb-4 size-8 text-primary" /><h2 id="goals-empty-title" className="text-xl font-semibold">Целей пока нет</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">{status === "archived" ? "Здесь появятся архивные цели. Их измерения и история сохранятся." : "Начните с одной цели. Первое измерение покажет, где вы сейчас, без выдуманных процентов."}</p>
        <Link href={createUrl} className="action-link mt-6">Создать цель</Link></section>
        : <div className="mt-6 grid gap-5 xl:grid-cols-2">{data.items.map((value) => <article key={value.goal.id} className="min-w-0 rounded-2xl border bg-card p-5 sm:p-6">
          <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{domains.find((domain) => domain.key === value.goal.domain_key)?.label}</p><StatusBadge status={value.goal.status} /></div>
          <h2 className="mt-4 wrap-anywhere text-xl font-semibold"><Link href={`/goals/${value.goal.id}`} className="rounded hover:underline underline-offset-4">{value.goal.title}</Link></h2>
          <div className="mt-5"><GoalProgressView value={value} preferences={preferences} compact /></div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-xs text-muted-foreground"><span>{value.progress.measurementCount} измерений</span>
            {value.goal.due_at && <span>Срок: <time dateTime={value.goal.due_at}>{formatDateTime(new Date(value.goal.due_at), preferences)}</time></span>}</div></article>)}</div>}
      {error && <div className="mt-5"><FormAlert tone="error">{error}</FormAlert></div>}
      {data.nextCursor && <button onClick={loadMore} disabled={pending} className="action-link-secondary mt-6 disabled:opacity-50">{pending ? "Загружаем…" : "Показать ещё цели"}</button>}
    </>}
  </>;
}
