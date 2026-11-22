"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { DomainKey, OnboardingState, UserPreferences } from "@lifeos/contracts";
import { plural } from "../../lib/dashboard-presentation.ts";
import { domainPresentation } from "../../lib/domain-presentation.ts";
import { setupStatus } from "../../lib/onboarding-presentation.ts";
import { useDismiss } from "../../lib/use-dismiss.ts";
import { FormAlert } from "../auth/form-parts.tsx";
import { ExamplesConfirm } from "../onboarding/examples-confirm.tsx";
import { StartDialog } from "../onboarding/start-dialog.tsx";
import type { ExampleGoalPreview } from "../onboarding/start-dialog.tsx";
import { SectionCard } from "../ui/section-card.tsx";
import { StatusChip } from "../ui/status-chip.tsx";

const GOALS = ["цель", "цели", "целей"] as const;

/** One row of the section (mockup 30): a bold caption with a hint on the left, the control on the right. */
function Row({ id, title, children, hint }: { id: string; title: string; hint: ReactNode; children: ReactNode }) {
  return <div className="flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
    <div className="grid min-w-0 flex-1 gap-1">
      <h3 id={`${id}-title`} className="text-[13px] leading-5 font-semibold">{title}</h3>
      <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">{hint}</p>
    </div>
    {children}
  </div>;
}

/**
 * Settings → «Начальная настройка» (mockup 30, LFS-220): the status of the setup, the button that opens the same popup as
 * the first visit (mockup 31), «Сферы в фокусе» (view only) and the example goals with «Удалить все примеры». The
 * «Ритм отметок» row of the mockup was removed by LFS-222. The server passes the state; every change re-renders the page
 * from the server.
 */
export function OnboardingSection({ state, preferences, sphereNames, examples }: {
  state: OnboardingState; preferences: UserPreferences; sphereNames: Record<DomainKey, string>; examples: readonly ExampleGoalPreview[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<ReactNode>(null);
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const closeConfirm = useCallback(() => { setConfirming(false); toggle.current?.focus(); }, []);
  useDismiss(confirming, closeConfirm, box, toggle);
  const status = setupStatus(state, preferences);
  const exampleGoals = state.goals.examples;

  return <SectionCard id="settings-onboarding" titleId="settings-onboarding-title" title="Начальная настройка" className="scroll-mt-4" contentClassName="grid gap-3.5"
    titleAddon={<StatusChip tone={status.done ? "green" : "neutral"}>{status.label}</StatusChip>}>
    {message && <FormAlert tone="success">{message}</FormAlert>}
    <div className="grid divide-y">
      <Row id="settings-start" title="Пример или вопросы по сферам"
        hint="Тот же выбор, что при первом входе: загрузить примерные цели или ответить на вопросы и получить цели со своими цифрами. Текущие цели не удаляются.">
        <button type="button" onClick={() => { setMessage(null); setOpen(true); }} aria-haspopup="dialog"
          className="action-link action-compact self-start sm:shrink-0 sm:self-auto">Открыть начальную настройку</button>
      </Row>
      <Row id="settings-focus" title="Сферы в фокусе" hint="Показываются первыми в Кабинете. Меняются при повторной настройке.">
        {state.focus_domains.length
          ? <ul aria-labelledby="settings-focus-title" className="flex flex-wrap gap-1.5 sm:justify-end">{state.focus_domains.map((key) =>
            <li key={key}><StatusChip tone={domainPresentation[key].tone}>{sphereNames[key]}</StatusChip></li>)}</ul>
          : <span className="text-xs text-muted-foreground">не выбраны</span>}
      </Row>
      <Row id="settings-examples" title="Примерные цели" hint={exampleGoals > 0
        ? <><span className="tabular-nums">{exampleGoals}</span> {plural(exampleGoals, GOALS)} с меткой «Пример». Удаляются вместе с измерениями и историей; цели, которые вы сделали своими, останутся.</>
        : "Сейчас в аккаунте примеров нет. Если загрузите пример, здесь появится кнопка «Удалить все примеры»."}>
        {exampleGoals > 0
          ? <div ref={box} className="relative self-start sm:shrink-0 sm:self-auto">
            <button ref={toggle} type="button" aria-expanded={confirming} onClick={() => setConfirming((value) => !value)}
              className="action-link-secondary action-compact border-destructive/55 bg-transparent text-destructive hover:bg-destructive/10">Удалить все примеры</button>
            {confirming && <ExamplesConfirm kind="remove" count={exampleGoals} close={closeConfirm} className="absolute top-[calc(100%+8px)] right-0 w-[min(400px,calc(100vw-2rem))] sm:w-[400px]"
              done={(deleted) => {
                setConfirming(false);
                setMessage(`Примеры удалены: ${deleted} ${plural(deleted, GOALS)}. Цели, которые вы сделали своими, остались.`);
                router.refresh();
              }} />}
          </div>
          : <span className="text-xs text-muted-foreground">нет</span>}
      </Row>
    </div>
    {open && <StartDialog mode="settings" status={state.status} goals={state.goals.total} exampleGoals={exampleGoals}
      focus={state.focus_domains.map((key) => sphereNames[key])} hasDraft={state.answers !== null} examples={examples} close={() => setOpen(false)}
      loaded={(created) => {
        setOpen(false);
        setMessage(<>Пример добавлен: <span className="tabular-nums">{created}</span> {plural(created, GOALS)} с меткой «Пример». <Link href="/dashboard" className="font-semibold underline underline-offset-4">Открыть Кабинет</Link></>);
        router.refresh();
      }} />}
  </SectionCard>;
}
