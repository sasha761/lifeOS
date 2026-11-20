import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { LIFE_DOMAINS } from "@lifeos/domain";
import { DomainIcon } from "@/components/ui/domain-icon";
import { SectionCard } from "@/components/ui/section-card";
import { StatusChip } from "@/components/ui/status-chip";

/**
 * Six registry cards on the overview. Each card is an article whose «Открыть сферу: <сфера>» link covers the
 * whole card. Navigation between spheres also lives in the top bar menu «Сферы».
 */
export function DomainCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {LIFE_DOMAINS.map((domain) => (
        <SectionCard key={domain.key} id={domain.key} role="article" titleId={`${domain.key}-title`} headingLevel={3} title={domain.name.ru}
          icon={<DomainIcon domain={domain.key} />} action={<StatusChip tone="outline">{domain.available ? "Общие цели" : "Планируется"}</StatusChip>}
          className="relative scroll-mt-28 transition-colors duration-[120ms] has-[a:hover]:bg-surface-2 has-[a:hover]:ring-border-strong" contentClassName="flex flex-1 flex-col">
          <p lang="en" className="text-xs font-medium text-muted-foreground">{domain.name.en}</p>
          <p className="mt-2 flex-1 text-xs leading-5 text-muted-foreground">{domain.description.ru}</p>
          <Link href={domain.url} aria-label={`Открыть сферу: ${domain.name.ru}`}
            className="group mt-4 flex items-center justify-between gap-3 rounded border-t pt-3 text-sm font-medium text-primary after:absolute after:inset-0 after:rounded-2xl">
            Открыть сферу <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 transition-transform duration-[120ms] group-hover:translate-x-0.5" />
          </Link>
        </SectionCard>
      ))}
    </div>
  );
}
