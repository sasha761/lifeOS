import type { Metadata } from "next";
import { Clock } from "lucide-react";
import { PreferencesForm } from "@/components/settings/preferences-form";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime, localeLabel, localeOptions, timeZoneOptions, utcOffsetLabel } from "@/lib/user-preferences";
import { requirePageSession } from "@/server/auth";
import { getUserPreferencesService } from "@/server/core";

export const metadata: Metadata = { title: "Настройки" };

export default async function SettingsPage() {
  const { user, actor } = await requirePageSession("/settings");
  // The actor comes from the verified session; the service reads only this user's row.
  const preferences = await getUserPreferencesService().get(actor);
  const now = new Date();
  const offset = utcOffsetLabel(now, preferences.timezone);
  return (
    <>
      <p className="text-sm font-medium text-muted-foreground">Настройки</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Часовой пояс и язык</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        Настройки аккаунта <span className="font-medium text-foreground">{user.email}</span>. Даты хранятся в UTC
        и показываются по выбранному часовому поясу.
      </p>
      <Card className="mt-8 max-w-xl rounded-2xl shadow-none [--card-spacing:--spacing(6)]">
        <CardContent className="flex flex-col items-start gap-4 sm:flex-row">
          <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
            <Clock className="size-5" strokeWidth={1.7} />
          </span>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">Часовой пояс</dt>
            <dd className="font-medium">{preferences.timezone}{offset && <span className="font-normal text-muted-foreground"> · {offset}</span>}</dd>
            <dt className="text-muted-foreground">Сейчас</dt>
            <dd><time dateTime={now.toISOString()}>{formatDateTime(now, preferences)}</time></dd>
            <dt className="text-muted-foreground">Язык и формат</dt>
            <dd>{localeLabel(preferences.locale)}</dd>
          </dl>
        </CardContent>
      </Card>
      <section aria-labelledby="preferences-title" className="mt-10 max-w-md">
        <h2 id="preferences-title" className="mb-5 text-xl font-semibold tracking-tight">Изменить</h2>
        <PreferencesForm initial={preferences} timeZones={timeZoneOptions(preferences.timezone)} locales={localeOptions(preferences.locale)} />
      </section>
    </>
  );
}
