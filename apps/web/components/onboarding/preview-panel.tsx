"use client";

import { cn } from "cn";
import type { DomainKey, UserPreferences } from "@lifeos/contracts";
import type { OnboardingProposal } from "@lifeos/domain/onboarding";
import { plural } from "../../lib/dashboard-presentation.ts";
import { DIRECTION_LABELS, GOAL_FORMS, proposalDeadline, proposalRange } from "../../lib/onboarding-presentation.ts";
import { StatusChip } from "../ui/status-chip.tsx";
import { DomainIcon } from "../ui/domain-icon.tsx";
import { Cap, KeyValue, TickBox } from "./controls.tsx";

/** One proposed goal as it will be created (`.pv`): title, how it is counted, start → target and the deadline. */
export function ProposalPreview({ proposal, preferences, active, isNew, explain }: { proposal: OnboardingProposal; preferences: UserPreferences; active?: boolean; isNew?: boolean; explain?: boolean }) {
  const deadline = proposalDeadline(proposal.draft, preferences);
  return <div className={cn("grid min-w-0 gap-2 rounded-[14px] border bg-background p-3.5", active && "border-primary")} data-testid="onboarding-preview-goal">
    <div className="flex min-w-0 items-center gap-2.5"><DomainIcon domain={proposal.domainKey} size="sm" />
      <p className="min-w-0 flex-1 text-sm leading-5 font-bold wrap-anywhere">{proposal.draft.title || "Без названия"}</p>
      {isNew && <StatusChip tone="primary">новая цель</StatusChip>}</div>
    <dl className="grid gap-2">
      <KeyValue label="Как считать">{DIRECTION_LABELS[proposal.draft.direction]}</KeyValue>
      <KeyValue label="Старт → цель">{proposalRange(proposal.draft, preferences.locale)}</KeyValue>
      {deadline && <KeyValue label="Срок">{deadline}</KeyValue>}
    </dl>
    {explain && <>
      <div aria-hidden="true" className="h-1.5 rounded-full bg-surface-3" />
      <p className="text-[11px] leading-4 text-muted-foreground">Прогресс появится после первого измерения. До этого на карточке «Недостаточно данных», а не 0%.</p>
    </>}
  </div>;
}

/**
 * «Что получится» on a sphere question (mockups 25, 26): the goals of this answer, updated while the person types, and
 * either the note of the question or what is already answered.
 */
export function QuestionPreview({ proposals, active, note, preferences, answered, remaining }: {
  proposals: OnboardingProposal[]; active: string | null; note: string | null; preferences: UserPreferences;
  answered: { label: string; value: string }[]; remaining: string[];
}) {
  return <aside aria-label="Что получится" className="grid min-w-0 content-start gap-3.5 rounded-2xl border bg-card px-5 py-[18px]" data-testid="onboarding-preview">
    <Cap>Что получится{proposals.length > 1 ? ` · ${proposals.length} ${plural(proposals.length, GOAL_FORMS)}` : ""}</Cap>
    <div aria-live="polite" className="grid gap-3.5">
      {proposals.length === 0
        ? <p className="rounded-[14px] border border-dashed px-3.5 py-3 text-xs leading-5 text-muted-foreground">Выберите вариант — здесь появится цель с вашими цифрами.</p>
        : proposals.map((proposal) => <ProposalPreview key={proposal.key} proposal={proposal} preferences={preferences} active={proposals.length > 1 && proposal.option === active}
          isNew={proposals.length === 1} explain={proposals.length === 1} />)}
    </div>
    {note
      ? <p className="rounded-[10px] border bg-surface-2 px-3 py-2.5 text-xs leading-5 text-foreground/85">{note}</p>
      : <>
        <div aria-hidden="true" className="h-px bg-border" />
        <Cap>Уже есть в ответах</Cap>
        <ul className="grid gap-2.5 text-xs leading-5">
          {answered.map((item) => <li key={item.label} className="flex items-center gap-2.5"><TickBox on /><span className="min-w-0 flex-1">{item.label}</span><span className="text-muted-foreground tabular-nums">{item.value}</span></li>)}
          {remaining.length > 0 && <li className="flex items-center gap-2.5 text-muted-foreground"><TickBox on={false} /><span className="min-w-0 flex-1">{remaining.join(", ")}</span><span>далее</span></li>}
        </ul>
      </>}
  </aside>;
}

export type SphereLabels = Record<DomainKey, string>;
