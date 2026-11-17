"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { userPreferencesResponseSchema } from "@lifeos/contracts";
import type { UserPreferences } from "@lifeos/contracts";
import { FormAlert, SubmitButton } from "@/components/auth/form-parts";
import type { SelectOption } from "@/lib/user-preferences";

type Status = { tone: "success" | "error"; message: ReactNode } | undefined;

const selectClass = "field-control";

function SelectField({ id, label, hint, defaultValue, children }: { id: string; label: string; hint: string; defaultValue: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={id} className="field-label">{label}</label>
      <select id={id} name={id} defaultValue={defaultValue} aria-describedby={`${id}-hint`} className={selectClass}>
        {children}
      </select>
      <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * Sends only the chosen values to PATCH /api/v1/me/preferences. The server validates them (its ICU
 * data is authoritative) and derives the user from the session; the form never sends a user id.
 */
export function PreferencesForm({ initial, timeZones, locales }: { initial: UserPreferences; timeZones: string[]; locales: SelectOption[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<Status>();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const values = new FormData(event.currentTarget);
    setPending(true);
    setStatus(undefined);
    try {
      const response = await fetch("/api/v1/me/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timezone: values.get("timezone"), locale: values.get("locale") }),
        cache: "no-store",
      });
      if (response.status === 401) {
        router.replace(`/auth/sign-in?next=${encodeURIComponent("/settings")}`);
        return;
      }
      const parsed = userPreferencesResponseSchema.safeParse(await response.json());
      const saved = parsed.success ? parsed.data.data : null;
      if (!response.ok || !saved) {
        setStatus({
          tone: "error",
          message: response.status === 400 ? "Такой часовой пояс или язык не поддерживается. Выберите значение из списка." : "Не удалось сохранить настройки. Попробуйте ещё раз.",
        });
        return;
      }
      setStatus({ tone: "success", message: <>Сохранено: <span className="font-medium">{saved.timezone}</span>, {saved.locale}.</> });
      // Re-render the server part of the page (current time and offset) with the stored values.
      router.refresh();
    } catch {
      setStatus({ tone: "error", message: "Не удалось сохранить настройки. Проверьте соединение и попробуйте ещё раз." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3.5" aria-busy={pending}>
      {status && <FormAlert tone={status.tone}>{status.message}</FormAlert>}
      <div className="grid gap-3.5 sm:grid-cols-2">
        <SelectField id="timezone" label="Часовой пояс" hint="Даты хранятся в UTC и показываются в этом часовом поясе." defaultValue={initial.timezone}>
          {timeZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
        </SelectField>
        <SelectField id="locale" label="Язык и формат дат" hint="Определяет формат дат и чисел. Интерфейс пока на русском." defaultValue={initial.locale}>
          {locales.map((locale) => <option key={locale.value} value={locale.value}>{locale.label}</option>)}
        </SelectField>
      </div>
      <div><SubmitButton className="action-compact" pending={pending} pendingLabel="Сохраняем…">Сохранить</SubmitButton></div>
    </form>
  );
}
