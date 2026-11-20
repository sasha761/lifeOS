import type { Metadata } from "next";
import { PreferencesForm } from "@/components/settings/preferences-form";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { formatDateTime, localeLabel, localeOptions, timeZoneOptions, utcOffsetLabel } from "@/lib/user-preferences";
import { requirePageSession } from "@/server/auth";
import { getUserPreferencesService } from "@/server/core";

export const metadata: Metadata = { title: "Настройки" };

// Mockup 16 for the sections that exist in Stage 2; Telegram (stage 3) and privacy (stage 8) are added with their tasks.
export default async function SettingsPage() {
  const { user, actor } = await requirePageSession("/settings");
  // The actor comes from the verified session; the service reads only this user's row.
  const preferences = await getUserPreferencesService().get(actor);
  const now = new Date();
  const offset = utcOffsetLabel(now, preferences.timezone);
  return (
    <>
      <PageHeader title="Настройки" />
      <div className="mt-4 grid max-w-[936px] gap-3.5">
        <SectionCard titleId="settings-profile-title" title="Профиль">
          <dl className="grid gap-x-6 gap-y-3.5 sm:grid-cols-2">
            <div className="grid min-w-0 gap-1.5"><dt className="field-label">Имя</dt><dd className="text-sm font-medium wrap-anywhere">{user.name}</dd></div>
            <div className="grid min-w-0 gap-1.5"><dt className="field-label">Email для входа</dt><dd className="text-sm font-medium wrap-anywhere">{user.email}</dd></div>
          </dl>
        </SectionCard>
        <SectionCard titleId="preferences-title" title="Язык и время" contentClassName="grid gap-3.5">
          <div className="grid gap-2 sm:grid-cols-3">
            <StatCard label="Часовой пояс" value={preferences.timezone} hint={offset || undefined} />
            <StatCard label="Сейчас" value={<time dateTime={now.toISOString()}>{formatDateTime(now, preferences)}</time>} />
            <StatCard label="Язык и формат" value={localeLabel(preferences.locale)} />
          </div>
          <PreferencesForm initial={preferences} timeZones={timeZoneOptions(preferences.timezone)} locales={localeOptions(preferences.locale)} />
          <p className="text-xs leading-5 text-muted-foreground">Даты и статистика по дням считаются в вашем часовом поясе. В базе время хранится в UTC.</p>
        </SectionCard>
      </div>
    </>
  );
}
