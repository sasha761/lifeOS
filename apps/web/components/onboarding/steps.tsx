"use client";

import type { Ref } from "react";
import { DOMAIN_KEYS } from "@lifeos/contracts";
import type { DomainKey } from "@lifeos/contracts";
import { ONBOARDING_QUESTIONS } from "@lifeos/domain/onboarding";
import { plural } from "../../lib/dashboard-presentation.ts";
import { FormAlert } from "../auth/form-parts.tsx";
import { DomainIcon } from "../ui/domain-icon.tsx";
import { StatusChip } from "../ui/status-chip.tsx";
import { Cap, OptionCard } from "./controls.tsx";
import type { SphereLabels } from "./preview-panel.tsx";

const headingClass = "text-[22px] leading-7 font-bold tracking-[-0.01em] focus:outline-none md:text-[26px] md:leading-8";
const noteClass = "rounded-[10px] border bg-surface-2 px-3 py-2.5 text-xs leading-5 text-foreground/85";

/** Step 1 (mockup 24 without the rhythm, LFS-222): which spheres matter; the questions, the step scale and «сферы в фокусе» follow from it. */
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
          : `Будет ${domains.length} ${plural(domains.length, ["вопрос", "вопроса", "вопросов"])} по сферам и итог. Это около ${minutes} ${plural(minutes, ["минуты", "минут", "минут"])}.`}</span>
      </p>
      <p className={`${noteClass} flex flex-wrap items-center gap-x-2.5`}><span className="text-muted-foreground">Порядок сфер на главной:</span><strong className="font-semibold text-foreground">сначала выбранные</strong></p>
    </div>
  </div>;
}

export { headingClass };
