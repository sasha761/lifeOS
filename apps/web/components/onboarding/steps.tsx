"use client";

import type { Ref } from "react";
import { DOMAIN_KEYS } from "@lifeos/contracts";
import type { CheckinRhythm, DomainKey } from "@lifeos/contracts";
import { CHECKIN_RHYTHM_OPTIONS, ONBOARDING_QUESTIONS } from "@lifeos/domain/onboarding";
import type { OnboardingProposal } from "@lifeos/domain/onboarding";
import { plural } from "../../lib/dashboard-presentation.ts";
import { GOAL_FORMS } from "../../lib/onboarding-presentation.ts";
import { FormAlert } from "../auth/form-parts.tsx";
import { DomainIcon } from "../ui/domain-icon.tsx";
import { StatusChip } from "../ui/status-chip.tsx";
import { Cap, OptionCard } from "./controls.tsx";
import type { SphereLabels } from "./preview-panel.tsx";

const headingClass = "text-[22px] leading-7 font-bold tracking-[-0.01em] focus:outline-none md:text-[26px] md:leading-8";
const noteClass = "rounded-[10px] border bg-surface-2 px-3 py-2.5 text-xs leading-5 text-foreground/85";

/** Step 1 (mockup 24): which spheres matter; the questions, the step scale and «сферы в фокусе» follow from it. */
export function SpheresStep({ labels, domains, missing, onChange, headingRef, headingId }: {
  labels: SphereLabels; domains: DomainKey[]; missing: boolean; onChange(domains: DomainKey[]): void; headingRef: Ref<HTMLHeadingElement>; headingId: string;
}) {
  const minutes = Math.max(1, Math.ceil(domains.length / 2));
  return <div className="grid min-w-0 gap-4 md:gap-[22px]">
    <fieldset className="grid min-w-0 gap-4 md:gap-[22px]" aria-describedby={`${headingId}-lead`}>
      <legend className="grid w-full max-w-[820px] gap-1.5 pb-1.5">
        <Cap className="text-primary">Сферы жизни</Cap>
        <h1 ref={headingRef} id={headingId} tabIndex={-1} className={headingClass}>Какие сферы для вас важны в ближайшие полгода?</h1>
      </legend>
      <p id={`${headingId}-lead`} className="max-w-[820px] text-sm leading-5 text-muted-foreground">Выберите одну или несколько. О невыбранных сферах спрашивать не будем, цели в них можно добавить позже.</p>
      {missing && <FormAlert tone="error">Выберите хотя бы одну сферу.</FormAlert>}
      <div className="grid gap-2.5 sm:grid-cols-2 md:gap-4 lg:grid-cols-3">
        {DOMAIN_KEYS.map((key) => <OptionCard key={key} type="checkbox" name="onb-domains" value={key} checked={domains.includes(key)} trailing
          onChange={(checked) => onChange(DOMAIN_KEYS.filter((candidate) => candidate === key ? checked : domains.includes(candidate)))}
          icon={<DomainIcon domain={key} />} label={labels[key]} description={ONBOARDING_QUESTIONS[key].summary} className="p-4" />)}
      </div>
    </fieldset>
    <div className="flex flex-col gap-2.5 md:flex-row md:items-stretch md:gap-4">
      <p className={`${noteClass} flex flex-1 items-center gap-2.5`} aria-live="polite">
        <StatusChip tone="primary">{domains.length} из {DOMAIN_KEYS.length}</StatusChip>
        <span>{domains.length === 0 ? "Выберите сферы — по каждой будет один вопрос."
          : `Будет ${domains.length} ${plural(domains.length, ["вопрос", "вопроса", "вопросов"])} по сферам, вопрос про ритм и итог. Это около ${minutes} ${plural(minutes, ["минуты", "минут", "минут"])}.`}</span>
      </p>
      <p className={`${noteClass} flex flex-wrap items-center gap-x-2.5`}><span className="text-muted-foreground">Порядок сфер на главной:</span><strong className="font-semibold text-foreground">сначала выбранные</strong></p>
    </div>
  </div>;
}

/** Rhythm step (no mockup; the look of the options of mockup 25): how often to record progress and the zone check. */
export function RhythmStep({ rhythm, timeZone, profileTimeZone, timeZones, missing, onRhythm, onTimeZone, headingRef, headingId }: {
  rhythm: CheckinRhythm | null; timeZone: string; profileTimeZone: string; timeZones: string[]; missing: boolean;
  onRhythm(rhythm: CheckinRhythm): void; onTimeZone(zone: string): void; headingRef: Ref<HTMLHeadingElement>; headingId: string;
}) {
  return <div className="grid min-w-0 gap-3.5 md:gap-[18px]">
    <fieldset className="grid min-w-0 gap-3.5 md:gap-[18px]" aria-describedby={`${headingId}-lead`}>
      <legend className="grid w-full gap-1.5 pb-1.5"><Cap className="text-primary">Ритм</Cap>
        <h1 ref={headingRef} id={headingId} tabIndex={-1} className={headingClass}>Как часто вы готовы отмечать прогресс?</h1></legend>
      <p id={`${headingId}-lead`} className="text-sm leading-5 text-muted-foreground">Ритм сохранится в профиле. Напоминания включатся, когда появится Telegram.</p>
      {missing && <FormAlert tone="error">Выберите вариант или нажмите «Пропустить вопрос».</FormAlert>}
      <div className="grid gap-2.5 sm:grid-cols-2">
        {CHECKIN_RHYTHM_OPTIONS.map((option) => <OptionCard key={option.key} type="radio" name="onb-rhythm" value={option.key} checked={rhythm === option.key}
          onChange={() => onRhythm(option.key)} label={option.label} description={option.description} />)}
      </div>
    </fieldset>
    <div className="grid gap-3 rounded-2xl border bg-surface-2 px-4 py-4 sm:px-[18px]">
      <label htmlFor="onb-timezone" className="text-sm leading-5 font-bold">Часовой пояс</label>
      <select id="onb-timezone" value={timeZone} onChange={(event) => onTimeZone(event.target.value)} aria-describedby="onb-timezone-hint" className="field-control sm:max-w-80">
        {timeZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
      </select>
      <p id="onb-timezone-hint" className="text-xs leading-5 text-muted-foreground">
        {timeZone === profileTimeZone ? "Взят из профиля. " : `В профиле сейчас ${profileTimeZone}; новый пояс сохранится вместе с целями. `}
        Сроки целей заканчиваются в конце выбранного дня в этом поясе.
      </p>
    </div>
  </div>;
}

/** Right panel of the rhythm step: the goals the answers give so far. */
export function RhythmPreview({ proposals }: { proposals: OnboardingProposal[] }) {
  return <aside aria-label="Что получится" className="grid min-w-0 content-start gap-3.5 rounded-2xl border bg-card px-5 py-[18px]">
    <Cap>Что получится · {proposals.length} {plural(proposals.length, GOAL_FORMS)}</Cap>
    {proposals.length > 0 && <ul className="grid gap-2.5 text-xs leading-5">
      {proposals.map((proposal) => <li key={proposal.key} className="flex min-w-0 items-center gap-2.5"><DomainIcon domain={proposal.domainKey} size="sm" /><span className="min-w-0 wrap-anywhere">{proposal.draft.title}</span></li>)}
    </ul>}
    <p className={noteClass}>Ритм — ваша договорённость с собой. Измерения вы добавляете сами, прогресс считается только по ним.</p>
  </aside>;
}

export { headingClass };
