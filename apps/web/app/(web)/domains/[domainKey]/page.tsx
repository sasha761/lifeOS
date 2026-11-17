import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Target } from "lucide-react";
import { findLifeDomain, LIFE_DOMAINS } from "@lifeos/domain";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { domainPresentation } from "@/lib/domain-presentation";

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

export default async function DomainPage({ params }: DomainPageProps) {
  const domain = await resolveDomain(params);
  return (
    <>
      <Link href="/#areas" className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden="true" className="size-4" /> Все сферы
      </Link>
      <EmptyState icon={domainPresentation[domain.key].icon} title={domain.name.ru} description={domain.description.ru} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="rounded-2xl shadow-none [--card-spacing:--spacing(6)]">
          <CardContent>
            <Target aria-hidden="true" className="mb-4 size-5 text-primary" strokeWidth={1.7} />
            <h2 className="text-lg font-semibold tracking-tight">Общие ручные цели</h2>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              Создайте измеримую цель в этой сфере и отмечайте изменения вручную. Прогресс строится по вашим измерениям.
            </p>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">Личные данные и прогресс здесь пока не отображаются.</p>
            <div className="mt-5 flex flex-wrap gap-3"><Link href={`/goals?domain_key=${domain.key}`} className="action-link-secondary">Цели сферы</Link>
              <Link href={`/goals/new?domain_key=${domain.key}`} className="action-link">Создать цель</Link></div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-none [--card-spacing:--spacing(6)]">
          <CardContent>
            <p className="mb-4 text-xs font-medium tracking-widest text-muted-foreground uppercase">Позже</p>
            <h2 className="text-lg font-semibold tracking-tight">Специализированный модуль появится позже</h2>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              Автоматические трекеры и внешние подключения пока недоступны. Здесь будут только данные из явно указанных источников.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
