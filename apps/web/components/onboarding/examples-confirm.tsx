"use client";

import { cn } from "cn";
import { starterPackRemovedSchema } from "@lifeos/contracts";
import { plural } from "../../lib/dashboard-presentation.ts";
import { CloseButton, MutationError, useGoalMutation } from "../goals/shared.tsx";
import { trapTab } from "../ui/modal-dialog.tsx";

const COUNT_GOALS = ["цель", "цели", "целей"] as const;
const EXAMPLE_GOALS = ["примерную цель", "примерные цели", "примерных целей"] as const;
const KEPT = "Цели, которые вы поправили или где есть ваши измерения, останутся.";

/**
 * The confirmation card of mockup 28 under the example banner, not a centred modal (LFS-218). LFS-220 reuses it for
 * «Пройти настройку вместо примера» and in Settings. Both delete the goals still labelled «Пример» with
 * `DELETE /api/v1/starter-pack`; `done` gets the number removed. Focus starts on «Отмена»; ✕ and «Отмена» call `close`,
 * Escape and a press outside are the caller's (`useDismiss`); Tab stays inside.
 */
export function ExamplesConfirm({ kind, count, close, done, className }: {
  kind: "remove" | "replace"; count: number; close(): void; done(deleted: number): void; className?: string;
}) {
  const action = useGoalMutation();
  const busy = action.pending || action.uncertain;
  const id = `${kind}-examples`;
  const confirm = kind === "remove" ? `Удалить ${count} ${plural(count, COUNT_GOALS)}` : "Удалить и открыть вопросы";
  return <section role="alertdialog" aria-modal="false" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onKeyDown={trapTab}
    className={cn("z-30 grid w-full gap-2.5 rounded-2xl border border-border-strong bg-card px-5 py-[18px] shadow-dialog sm:w-[400px]", className)}>
    <div className="flex items-center gap-3"><h2 id={`${id}-title`} className="text-sm font-bold">{kind === "remove" ? "Удалить все примеры?" : "Пройти настройку вместо примера?"}</h2>
      <span className="ml-auto"><CloseButton disabled={busy} onClick={close} /></span></div>
    <MutationError error={action.error} uncertain={action.uncertain} />
    <p id={`${id}-description`} className="text-xs leading-5 text-muted-foreground sm:text-[13px]">
      Удалим <span className="tabular-nums">{count}</span> {plural(count, EXAMPLE_GOALS)}{kind === "remove"
        ? <> вместе с их измерениями и историей. {KEPT}</> : <> и откроем вопросы. {KEPT}</>}</p>
    <div className="flex flex-wrap justify-end gap-2.5">
      {/* The safe choice gets focus, as in the goal deletion dialog (LFS-216). */}
      <button type="button" autoFocus disabled={busy} onClick={close} className="action-link-secondary action-sm disabled:opacity-50">Отмена</button>
      <button type="button" disabled={action.pending} className="action-link-secondary action-sm border-destructive/55 text-destructive hover:bg-destructive/10 disabled:opacity-50"
        onClick={() => void action.save({ url: "/api/v1/starter-pack", method: "DELETE" }, starterPackRemovedSchema, (result) => done(result.deleted_goals))}>
        {action.pending ? "Удаляем…" : action.uncertain ? "Повторить запрос" : confirm}</button>
    </div>
  </section>;
}
