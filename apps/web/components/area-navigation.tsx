import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { LIFE_DOMAINS } from "@lifeos/domain";
import { domainPresentation } from "@/lib/domain-presentation";

/** Six registry cards on the overview. Navigation between spheres lives in the top bar menu «Сферы». */
export function DomainCards() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {LIFE_DOMAINS.map((domain) => {
        const { icon: Icon, tone } = domainPresentation[domain.key];
        return (
          <article id={domain.key} key={domain.key} aria-labelledby={`${domain.key}-title`} className="scroll-mt-28">
            <Link href={domain.url} aria-labelledby={`${domain.key}-title`}
              className="group flex h-full flex-col rounded-2xl border bg-card p-5 transition-colors duration-[120ms] hover:border-border-strong hover:bg-surface-2">
              <div className="flex items-start justify-between gap-3">
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-[10px] ${tone}`}>
                  <Icon aria-hidden="true" className="size-5" strokeWidth={1.8} />
                </span>
                <span className="rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground">{domain.available ? "Общие цели" : "Планируется"}</span>
              </div>
              <h3 id={`${domain.key}-title`} className="mt-5 text-[17px] leading-6 font-semibold">{domain.name.ru}</h3>
              <p lang="en" className="text-xs font-medium text-muted-foreground">{domain.name.en}</p>
              <p className="mt-3 flex-1 text-[13px] leading-[18px] text-muted-foreground">{domain.description.ru}</p>
              <div className="mt-5 flex items-center justify-between gap-3 border-t pt-4 text-sm font-medium text-primary">
                Открыть сферу <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 transition-transform duration-[120ms] group-hover:translate-x-0.5" />
              </div>
            </Link>
          </article>
        );
      })}
    </div>
  );
}
