import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Plus, Target } from "lucide-react";
import { findLifeDomain } from "@lifeos/domain";
import { DomainPersonal } from "@/components/domains/domain-personal";
import { DomainIcon } from "@/components/ui/domain-icon";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusChip } from "@/components/ui/status-chip";
import { getPageSession } from "@/server/auth";
import { getUserPreferencesService } from "@/server/core";

type DomainPageProps = { params: Promise<{ domainKey: string }> };

// Only the registry's six keys exist. The page reads the session per request (LFS-213), so a notFound() here comes
// after the (web) loading boundary started streaming and keeps status 200: proxy.ts answers unknown keys with a real
// 404 first. This check stays as the second line of defence.
async function resolveDomain(params: DomainPageProps["params"]) {
  const domain = findLifeDomain((await params).domainKey);
  if (!domain) notFound();
  return domain;
}

export async function generateMetadata({ params }: DomainPageProps): Promise<Metadata> {
  const domain = await resolveDomain(params);
  return { title: domain.name.ru, description: domain.description.ru };
}

// Mockup 10. Public registry text for guests; a signed-in owner sees the sphere's goals and journal (LFS-213), so the
// page is rendered per request.
export default async function DomainPage({ params }: DomainPageProps) {
  const domain = await resolveDomain(params);
  const session = await getPageSession();
  const preferences = session ? await getUserPreferencesService().get(session.actor) : null;
  const moduleCard = <SectionCard variant="dashed" titleId="domain-module-title" title="Специализированный модуль появится позже" action={<StatusChip>Позже</StatusChip>}>
    <p className="text-sm leading-6 text-muted-foreground">
      Автоматические трекеры и внешние подключения пока недоступны. Здесь будут только данные из явно указанных источников.
    </p>
  </SectionCard>;
  return (
    <>
      <Link href="/#areas" className="mb-2 inline-flex min-h-11 items-center gap-2 rounded-full pr-3 text-sm text-muted-foreground transition-colors duration-[120ms] hover:text-foreground pointer-fine:min-h-8">
        <ArrowLeft aria-hidden="true" className="size-4" /> Все сферы
      </Link>
      <PageHeader title={domain.name.ru} description={domain.description.ru} icon={<DomainIcon domain={domain.key} size="lg" />}
        actions={<Link href={`/goals/new?domain_key=${domain.key}`} className="action-link action-compact"><Plus aria-hidden="true" className="size-4" />Цель в сфере</Link>} />
      {preferences
        ? <DomainPersonal domainKey={domain.key} label={domain.name.ru} preferences={preferences} moduleCard={moduleCard} />
        : <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <SectionCard titleId="domain-goals-title" title="Общие ручные цели" icon={<Target aria-hidden="true" className="size-[18px] text-primary" strokeWidth={1.7} />}>
            <p className="text-sm leading-6 text-muted-foreground">
              Создайте измеримую цель в этой сфере и отмечайте изменения вручную. Прогресс строится по вашим измерениям.
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Личные цели и действия появятся здесь после входа.</p>
            <Link href={`/goals?domain_key=${domain.key}`} className="action-link-secondary action-compact mt-4">Цели сферы</Link>
          </SectionCard>
          {moduleCard}
        </div>}
    </>
  );
}
