import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Plus, Target } from "lucide-react";
import { findLifeDomain, LIFE_DOMAINS } from "@lifeos/domain";
import { DomainIcon } from "@/components/ui/domain-icon";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusChip } from "@/components/ui/status-chip";

type DomainPageProps = { params: Promise<{ domainKey: string }> };

// Only the registry's six public metadata pages exist; unknown keys cannot become new spheres.
export const dynamicParams = false;
export function generateStaticParams() {
  return LIFE_DOMAINS.map((domain) => ({ domainKey: domain.key }));
}

async function resolveDomain(params: DomainPageProps["params"]) {
  const domain = findLifeDomain((await params).domainKey);
  if (!domain) notFound();
  return domain;
}

export async function generateMetadata({ params }: DomainPageProps): Promise<Metadata> {
  const domain = await resolveDomain(params);
  return { title: domain.name.ru, description: domain.description.ru };
}

// Public page from the registry (mockup 10 without personal data: goals and actions of a sphere are not shown here yet).
export default async function DomainPage({ params }: DomainPageProps) {
  const domain = await resolveDomain(params);
  return (
    <>
      <Link href="/#areas" className="mb-2 inline-flex min-h-11 items-center gap-2 rounded-full pr-3 text-sm text-muted-foreground transition-colors duration-[120ms] hover:text-foreground pointer-fine:min-h-8">
        <ArrowLeft aria-hidden="true" className="size-4" /> Все сферы
      </Link>
      <PageHeader title={domain.name.ru} description={domain.description.ru} icon={<DomainIcon domain={domain.key} size="lg" />}
        actions={<Link href={`/goals/new?domain_key=${domain.key}`} className="action-link action-compact"><Plus aria-hidden="true" className="size-4" />Цель в сфере</Link>} />
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SectionCard titleId="domain-goals-title" title="Общие ручные цели" icon={<Target aria-hidden="true" className="size-[18px] text-primary" strokeWidth={1.7} />}>
          <p className="text-sm leading-6 text-muted-foreground">
            Создайте измеримую цель в этой сфере и отмечайте изменения вручную. Прогресс строится по вашим измерениям.
          </p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Личные данные и прогресс здесь пока не отображаются.</p>
          <Link href={`/goals?domain_key=${domain.key}`} className="action-link-secondary action-compact mt-4">Цели сферы</Link>
        </SectionCard>
        <SectionCard variant="dashed" titleId="domain-module-title" title="Специализированный модуль появится позже" action={<StatusChip>Позже</StatusChip>}>
          <p className="text-sm leading-6 text-muted-foreground">
            Автоматические трекеры и внешние подключения пока недоступны. Здесь будут только данные из явно указанных источников.
          </p>
        </SectionCard>
      </div>
    </>
  );
}
