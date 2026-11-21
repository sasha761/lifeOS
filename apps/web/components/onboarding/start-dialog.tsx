"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowRight, LayoutList, Sparkles } from "lucide-react";
import { cn } from "cn";
import { onboardingStateSchema, starterPackAppliedSchema } from "@lifeos/contracts";
import type { DomainKey, OnboardingStatus } from "@lifeos/contracts";
import { plural } from "../../lib/dashboard-presentation.ts";
import { CloseButton, ExampleChip, MutationError, useGoalMutation } from "../goals/shared.tsx";
import { DomainIcon } from "../ui/domain-icon.tsx";
import { ModalDialog } from "../ui/modal-dialog.tsx";
import { StatusChip } from "../ui/status-chip.tsx";
import { Cap } from "./controls.tsx";

/** A goal of the example set as the server passes it (STARTER_PACK, LFS-218): its sphere and title, in set order. */
export type ExampleGoalPreview = { domain_key: DomainKey; title: string };
const GOALS = ["цель", "цели", "целей"] as const;
const lowerFirst = (value: string) => value.charAt(0).toLocaleLowerCase("ru") + value.slice(1);

type StartDialogProps = {
  /** `first`: the first-visit popup of /dashboard (mockup 23); `settings`: the same popup opened from Settings (31). */
  mode: "first" | "settings";
  status: OnboardingStatus;
  /** All goals of the account, active and archived («Ваши N целей останутся как есть»). */
  goals: number;
  /** Goals still labelled «Пример»: «Добавить пример» is inactive while there are any. */
  exampleGoals: number;
  /** Names of «сферы в фокусе», in registry order. */
  focus: string[];
  /** Answers of an earlier setup are offered as a draft. */
  hasDraft: boolean;
  examples: readonly ExampleGoalPreview[];
  /** ✕, «Закрыть» and Escape. */
  close(): void;
  /** The example is in the account. */
  loaded(created: number): void;
  /** «Начать с чистого листа» is stored. */
  dismissed?(): void;
};

/** `.dom` square of an option card: ▤ amber for the example, ✦ violet for the questions. */
function OptionIcon({ kind, small = false }: { kind: "example" | "wizard"; small?: boolean }) {
  const Icon = kind === "example" ? LayoutList : Sparkles;
  return <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center justify-center",
    kind === "example" ? "bg-st-amber/20 text-st-amber" : "bg-primary/20 text-primary",
    small ? "size-[22px] rounded-[7px] [&>svg]:size-3.5" : "size-[30px] rounded-[9px] [&>svg]:size-4")}><Icon /></span>;
}

/** Card of one option (mockup `.card.s2` / `.card.sel`); the questions are the highlighted choice. */
function OptionCard({ kind, title, chip, compact = false, children }: { kind: "example" | "wizard"; title: string; chip?: ReactNode; compact?: boolean; children: ReactNode }) {
  return <section aria-label={title} className={cn("flex min-w-0 flex-col rounded-2xl border",
    kind === "wizard" ? "border-primary bg-primary/6" : "bg-surface-2", compact ? "gap-1.5 rounded-[14px] p-3.5" : "gap-3.5 p-5")}>
    <div className="flex items-center gap-2.5">
      <OptionIcon kind={kind} small={compact} />
      <h3 className={compact ? "text-sm font-bold" : "text-base leading-[22px] font-bold"}>{title}</h3>
      {chip && <span className="ml-auto">{chip}</span>}
    </div>
    {children}
  </section>;
}

/** `.pv`: the inset block with the example goals or the steps of the questions. */
function Preview({ children, note }: { children: ReactNode; note?: string }) {
  return <div className="grid gap-2 rounded-[14px] border bg-background p-3.5">
    {children}
    {note && <p className="text-[11px] leading-4 text-muted-foreground">{note}</p>}
  </div>;
}

function Step({ mark, children }: { mark: string; children: ReactNode }) {
  return <p className="flex items-center gap-2.5 text-xs leading-5">
    <StatusChip tone="outline" className="w-[46px] shrink-0 justify-center tabular-nums">{mark}</StatusChip><span className="min-w-0">{children}</span></p>;
}

/**
 * The start choice of the account (LFS-220): an example (LFS-218), the questions (LFS-219) or, on the first visit, a blank
 * account. One component for /dashboard and Settings. A native modal dialog: focus inside, Escape is «✕». From 640px a
 * centred window with two cards (mockups 23 and 31); on a phone a bottom sheet with full-width buttons (mockup 29).
 *
 * - «Начать настройку» stores `in_progress` and opens /onboarding; with a draft it is «Продолжить настройку».
 * - «Заполнить примером» / «Добавить пример» loads the example; the server completes a setup that is not completed.
 * - «Начать с чистого листа» (first visit only) stores `dismissed`; in Settings «Закрыть» takes its place.
 * - «Начать вопросы» in Settings only opens /onboarding: the earlier answers are its draft, nothing is stored before.
 */
export function StartDialog({ mode, status, goals, exampleGoals, focus, hasDraft, examples, close, loaded, dismissed }: StartDialogProps) {
  const router = useRouter();
  const example = useGoalMutation();
  const choice = useGoalMutation();
  const busy = example.pending || choice.pending;
  const first = mode === "first";
  const exampleInAccount = exampleGoals > 0;
  const shown = examples.slice(0, first ? 3 : 2);
  const rest = examples.slice(shown.length);
  const wizardLabel = !first ? "Начать вопросы" : status === "in_progress" ? "Продолжить настройку" : "Начать настройку";
  const exampleLabel = first ? "Заполнить примером" : "Добавить пример";

  function loadExample() {
    void example.save({ url: "/api/v1/starter-pack", method: "POST" }, starterPackAppliedSchema, (result) => loaded(result.created_goals));
  }
  function choose(next: "wizard" | "blank") {
    const body = next === "wizard" ? { status: "in_progress", choice: "wizard" } : { status: "dismissed", choice: "blank" };
    void choice.save({ url: "/api/v1/onboarding", method: "PATCH", body }, onboardingStateSchema, () => {
      if (next === "wizard") router.push("/onboarding"); else dismissed?.();
    });
  }

  const wizardButton = (className: string) => first
    ? <button type="button" disabled={busy} onClick={() => choose("wizard")} className={cn("action-link action-compact w-full disabled:opacity-60", className)}>
      {choice.pending ? "Открываем…" : wizardLabel}<ArrowRight aria-hidden="true" className="size-4" /></button>
    : <Link href="/onboarding" className={cn("action-link action-compact w-full", className)}>{wizardLabel}<ArrowRight aria-hidden="true" className="size-4" /></Link>;
  // The desktop and the phone layout each render the button and its note; the ids differ by layout.
  const exampleButton = (layout: "wide" | "phone", className: string) => <button type="button" disabled={busy || exampleInAccount} onClick={loadExample}
    aria-describedby={exampleInAccount ? `start-dialog-example-present-${layout}` : undefined}
    className={cn("action-link-secondary action-compact w-full disabled:cursor-not-allowed disabled:opacity-60", className)}>{example.pending ? "Добавляем пример…" : exampleLabel}</button>;
  const exampleNote = (layout: "wide" | "phone") => exampleInAccount
    ? <p id={`start-dialog-example-present-${layout}`} className="text-[11px] leading-4 text-muted-foreground">Пример уже в аккаунте: сначала удалите его в разделе «Примерные цели».</p> : null;

  // A 409 of the example means it is already loaded; of the choice, that the setup was completed meanwhile.
  const exampleError = example.status === 409 ? "Пример уже в аккаунте. Обновите страницу." : example.error;
  const choiceError = choice.status === 409 ? "Начальная настройка уже пройдена. Обновите страницу." : choice.error;
  const error = exampleError ?? choiceError;

  const title = first ? "Добро пожаловать в LifeOS" : "Что добавить в аккаунт?";
  const description = first
    ? { long: "В аккаунте пока пусто. Выберите, как начать: посмотреть, как всё устроено, на примере, или сразу настроить цели под себя.", short: "В аккаунте пока пусто. Как начнём?" }
    : null;
  const exampleText = first
    ? { long: `Создадим ${examples.length} ${plural(examples.length, ["примерную цель", "примерные цели", "примерных целей"])} во всех шести сферах с примерными измерениями. Их можно поправить под себя или удалить.`,
      short: `${examples.length} ${plural(examples.length, ["примерная цель", "примерные цели", "примерных целей"])} во всех сферах. Можно поправить или удалить. ≈ 10 секунд.` }
    : { long: `Добавим ${examples.length} ${plural(examples.length, ["примерную цель", "примерные цели", "примерных целей"])} во всех шести сферах${goals > 0 ? " рядом с вашими" : ""}. Всё будет помечено «Пример» и удаляется одной кнопкой.`,
      short: `${examples.length} ${plural(examples.length, ["примерная цель", "примерные цели", "примерных целей"])}${goals > 0 ? " рядом с вашими" : ""}, с меткой «Пример». Удаляются одной кнопкой.` };
  const resumed = first && status === "in_progress";
  const wizardText = first
    ? { long: resumed ? "Вы уже начали: ответы сохранены, продолжим с того же шага. По ответам предложим цели с вашими цифрами, а вы проверите их перед созданием."
      : "Несколько коротких вопросов о ваших сферах жизни. По ответам предложим цели с вашими цифрами, а вы проверите их перед созданием.",
      short: resumed ? "Ответы сохранены, продолжим с того же шага. Предложим цели с вашими цифрами." : "Несколько вопросов о сферах жизни. Предложим цели с вашими цифрами. ≈ 3 минуты." }
    : { long: `${status === "completed" ? "Пройдите вопросы по сферам ещё раз." : "Ответьте на вопросы по сферам."} Новые цели добавятся к текущим, ничего не удалится.${hasDraft ? " Ответы прошлой настройки подставим как черновик." : ""}`,
      short: `Новые цели добавятся к текущим, ничего не удалится.${hasDraft ? " Прошлые ответы — как черновик." : ""}` };
  const recommended = first ? <StatusChip tone="primary">Рекомендуем</StatusChip> : undefined;

  return <ModalDialog labelledBy="start-dialog-title" describedBy="start-dialog-description" busy={busy} onClose={close} data-testid="start-dialog"
    className={cn("mx-0 mt-auto mb-0 max-h-[calc(100dvh-1rem)] w-full max-w-none rounded-t-[24px] rounded-b-none border-x-0 border-b-0 border-border-strong px-4 pt-2.5 pb-6",
      "sm:mx-auto sm:mt-[min(92px,10dvh)] sm:mb-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:max-w-[860px] sm:rounded-[20px] sm:border sm:border-border sm:px-[26px] sm:py-6")}>
    <span aria-hidden="true" className="mx-auto mb-3 block h-1 w-10 rounded-full bg-border-strong sm:hidden" />
    <div className="flex items-start gap-3">
      <div className="grid min-w-0 gap-1.5">
        <Cap className="text-primary">{first ? "Первый вход" : "Начальная настройка"}</Cap>
        <h2 id="start-dialog-title" className="text-xl leading-[26px] font-bold tracking-[-0.01em] sm:text-2xl sm:leading-[30px]">{title}</h2>
        <p id="start-dialog-description" className="text-[13px] leading-5 text-muted-foreground sm:text-sm">
          {description
            ? <><span className="sm:hidden">{description.short}</span><span className="hidden sm:inline">{description.long}</span></>
            : goals > 0
              ? <>Ваши <strong className="font-bold text-foreground"><span className="tabular-nums">{goals}</span> {plural(goals, GOALS)}</strong> останутся как есть. Выберите, что добавить к ним.</>
              : "В аккаунте пока нет целей. Выберите, с чего начать."}
        </p>
      </div>
      <span className="ml-auto"><CloseButton disabled={busy} onClick={close} /></span>
    </div>

    {error && <div className="mt-4"><MutationError error={error} uncertain={example.uncertain || choice.uncertain} /></div>}

    {/* From 640px (mockups 23, 31): the example on the left, the questions on the right, each with its button. */}
    <div className="mt-4 hidden gap-4 sm:grid md:grid-cols-2">
      <OptionCard kind="example" title="Посмотреть на примере">
        <p className="text-xs leading-5 text-muted-foreground">{exampleText.long}</p>
        <Preview note={rest.length ? `и ещё ${rest.length} ${plural(rest.length, GOALS)}${first ? `: ${rest.map((goal) => lowerFirst(goal.title)).join(", ")}` : ""}` : undefined}>
          {shown.map((goal) => <p key={goal.title} className="flex items-center gap-2.5 text-xs leading-5">
            <DomainIcon domain={goal.domain_key} size="sm" /><span className="min-w-0 flex-1">{goal.title}</span><ExampleChip /></p>)}
        </Preview>
        {first && <div className="flex flex-wrap gap-1.5">{["≈ 10 секунд", "всё помечено «Пример»", "удаляется одной кнопкой"].map((label) =>
          <StatusChip key={label} tone="outline">{label}</StatusChip>)}</div>}
        {exampleNote("wide")}
        {exampleButton("wide", "mt-auto py-2.5")}
      </OptionCard>
      <OptionCard kind="wizard" title={first ? "Настроить под себя" : "Ответить на вопросы"} chip={recommended}>
        <p className="text-xs leading-5 text-muted-foreground">{wizardText.long}</p>
        <Preview note={first ? "в конце покажем список целей, ничего не создаётся без вашего «ОК»" : undefined}>
          <Step mark="1">{!first && focus.length ? `Сферы в фокусе: ${focus.join(", ")}` : "Какие сферы важны сейчас"}</Step>
          <Step mark="2–7">По вопросу на каждую выбранную сферу</Step>
          {first ? <Step mark="8">Ритм: как часто отмечать прогресс</Step> : <Step mark="итог">Список целей, создаются только отмеченные</Step>}
        </Preview>
        {first && <div className="flex flex-wrap gap-1.5">{["≈ 3 минуты", "любой вопрос можно пропустить", "свой вариант ответа"].map((label) =>
          <StatusChip key={label} tone="outline">{label}</StatusChip>)}</div>}
        {wizardButton("mt-auto py-2.5")}
      </OptionCard>
    </div>
    <div className="mt-4 hidden items-center gap-3 sm:flex">
      {first
        ? <button type="button" disabled={busy} onClick={() => choose("blank")} className="action-link-secondary action-compact border-border bg-transparent text-muted-foreground disabled:opacity-60">Начать с чистого листа</button>
        : <button type="button" disabled={busy} onClick={close} className="action-link-secondary action-compact border-border bg-transparent text-muted-foreground disabled:opacity-60">Закрыть</button>}
      {first && <p className="ml-auto max-w-[470px] text-right text-xs leading-5 text-muted-foreground">Выбор не окончательный: пример удаляется одной кнопкой, а настройку можно пройти позже в ⚙ Настройки → Начальная настройка.</p>}
    </div>

    {/* Phone (mockup 29, left screen): the questions first, short texts, the buttons below at full width. */}
    <div className="mt-3 grid gap-3 sm:hidden">
      <OptionCard kind="wizard" title={first ? "Настроить под себя" : "Ответить на вопросы"} chip={recommended} compact>
        <p className="text-xs leading-5 text-muted-foreground">{wizardText.short}</p>
      </OptionCard>
      <OptionCard kind="example" title="Посмотреть на примере" compact>
        <p className="text-xs leading-5 text-muted-foreground">{exampleText.short}</p>
      </OptionCard>
      {wizardButton("py-3")}
      {exampleNote("phone")}
      {exampleButton("phone", "py-3")}
      {first
        ? <button type="button" disabled={busy} onClick={() => choose("blank")} className="mx-auto min-h-11 rounded px-3 text-xs text-muted-foreground disabled:opacity-60">Начать с чистого листа</button>
        : <button type="button" disabled={busy} onClick={close} className="mx-auto min-h-11 rounded px-3 text-xs text-muted-foreground disabled:opacity-60">Закрыть</button>}
    </div>
  </ModalDialog>;
}
