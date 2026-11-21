import type { Metadata } from "next";
import Link from "next/link";
import { LIFE_DOMAINS, STARTER_PACK } from "@lifeos/domain";
import type { DomainKey } from "@lifeos/contracts";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { OnboardingSection } from "@/components/settings/onboarding-section";
import { PreferencesForm } from "@/components/settings/preferences-form";
import { SettingsNav } from "@/components/settings/settings-nav";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { localeOptions, timeZoneOptions } from "@/lib/user-preferences";
import { getSignupMode, requirePageSession } from "@/server/auth";
import { getOnboardingService, getUserPreferencesService } from "@/server/core";

export const metadata: Metadata = { title: "Настройки" };

const SECTIONS = [{ id: "settings-profile", label: "Профиль" }, { id: "settings-preferences", label: "Язык и время" },
  { id: "settings-onboarding", label: "Начальная настройка" }];
const sphereNames = Object.fromEntries(LIFE_DOMAINS.map((domain) => [domain.key, domain.name.ru])) as Record<DomainKey, string>;
// The example set as the popup describes it (LFS-220): the real set, not the mockup.
const examples = STARTER_PACK.map(({ goal }) => ({ domain_key: goal.domain_key, title: goal.title }));

// Mockup 16 for the sections that exist in Stage 2 and mockup 30 for «Начальная настройка» (LFS-220); Telegram (stage 3)
// and privacy (stage 8) are added with their tasks.
export default async function SettingsPage() {
  const { user, actor } = await requirePageSession("/settings");
  // The actor comes from the verified session; the service reads only this user's row.
  const [preferences, onboarding] = await Promise.all([getUserPreferencesService().get(actor), getOnboardingService().get(actor)]);
  return (
    <>
      <PageHeader title="Настройки" />
      <div className="mt-4 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-6">
        <SettingsNav sections={SECTIONS} />
        <div className="grid min-w-0 gap-3.5">
          <SectionCard id="settings-profile" titleId="settings-profile-title" title="Профиль" className="scroll-mt-4" contentClassName="grid gap-3.5">
            <div className="grid gap-x-6 gap-y-3.5 sm:grid-cols-2">
              <ReadOnlyField id="profile-name" label="Имя" value={user.name} />
              <ReadOnlyField id="profile-email" label="Email для входа" value={user.email} />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Link href="/auth/forgot-password" className="action-link-secondary action-compact">Изменить пароль</Link>
              <p className="min-w-0 flex-1 basis-64 text-xs leading-5 text-muted-foreground">
                {/* Mockup 16 shows the closed-registration note; with open registration (LFS-221) it is omitted. */}
                {getSignupMode() === "allowlist" && "Регистрация закрыта: новые аккаунты создаются только для адресов из списка доступа. "}
                Пароль меняется по ссылке из письма.
              </p>
            </div>
            <div className="flex border-t pt-3.5"><SignOutButton /></div>
          </SectionCard>
          <SectionCard id="settings-preferences" titleId="preferences-title" title="Язык и время" className="scroll-mt-4" contentClassName="grid gap-3.5">
            <PreferencesForm initial={preferences} timeZones={timeZoneOptions(preferences.timezone)} locales={localeOptions(preferences.locale)} />
            <p className="text-xs leading-5 text-muted-foreground">Даты и статистика по дням считаются в вашем часовом поясе. В базе время хранится в UTC.</p>
          </SectionCard>
          <OnboardingSection state={onboarding} preferences={preferences} sphereNames={sphereNames} examples={examples} />
        </div>
      </div>
    </>
  );
}

/** Profile values shown as fields, as in mockup 16; they are not editable in Stage 2. */
function ReadOnlyField({ id, label, value }: { id: string; label: string; value: string }) {
  return <div className="grid min-w-0 gap-1.5"><label htmlFor={id} className="field-label">{label}</label>
    <input id={id} readOnly value={value} title={value} className="field-control text-muted-foreground" /></div>;
}
