"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { X } from "lucide-react";
import type { DomainKey, UserPreferences } from "@lifeos/contracts";
import { Card } from "../ui/card.tsx";
import { GoalForm } from "./goal-form.tsx";
import { Modal } from "./shared.tsx";
import type { DomainChoice } from "./shared.tsx";

type NewGoalProps = { domains: DomainChoice[]; preferences: UserPreferences; domainKey?: DomainKey };

/** Direct visit or refresh of /goals/new: the «Новая цель» dialog card from mockup 10, standing on its own page. */
export function NewGoalPage({ domains, preferences, domainKey }: NewGoalProps) {
  return <Card className="mx-auto w-full max-w-[560px] gap-3.5 rounded-[20px] px-5 py-5 text-[13px] sm:px-6 sm:py-[22px]">
    <div className="flex items-center justify-between gap-4">
      <h1 className="text-base leading-[22px] font-bold">Новая цель</h1>
      <Link href="/goals" aria-label="Закрыть" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border text-muted-foreground transition-colors duration-[120ms] hover:border-border-strong hover:bg-surface-3 hover:text-foreground pointer-coarse:size-11">
        <X aria-hidden="true" className="size-4" /></Link>
    </div>
    <GoalForm domains={domains} preferences={preferences} domainKey={domainKey}
      cancel={<Link href="/goals" className="action-link-secondary action-compact">Отмена</Link>} />
  </Card>;
}

/**
 * Client-side navigation to /goals/new from any page of the web shell (`@modal/(.)goals/new`): the same form as a
 * modal over the current page, as in mockup 10. Closing goes back in history, so the page under it stays as it was.
 */
export function NewGoalDialog({ domains, preferences, domainKey }: NewGoalProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const close = () => { if (!busy) router.back(); };
  return <Modal title="Новая цель" busy={busy} close={close}>
    <GoalForm domains={domains} preferences={preferences} domainKey={domainKey} onBusyChange={setBusy}
      cancel={<button type="button" disabled={busy} onClick={close} className="action-link-secondary action-compact disabled:opacity-50">Отмена</button>} />
  </Modal>;
}
