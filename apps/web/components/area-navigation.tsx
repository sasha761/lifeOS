import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { LIFE_DOMAINS } from "@lifeos/domain";
import { NavigationLink } from "@/components/navigation-link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { domainPresentation } from "@/lib/domain-presentation";

export function AreaNavigation() {
  return (
    <nav aria-label="Сферы развития">
      <p className="mb-3 px-3 text-xs font-medium tracking-widest text-muted-foreground uppercase">Направления</p>
      <ul className="grid grid-cols-2 gap-1 min-[400px]:grid-cols-3 md:grid-cols-6 lg:grid-cols-1">
        {LIFE_DOMAINS.map((domain) => {
          const Icon = domainPresentation[domain.key].icon;
          return (
            <li key={domain.key}>
              <NavigationLink href={domain.url}>
                <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.7} />
                <span>{domain.name.ru}</span>
              </NavigationLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function DomainCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {LIFE_DOMAINS.map((domain) => {
        const { icon: Icon, tone } = domainPresentation[domain.key];
        return (
          <article id={domain.key} key={domain.key} aria-labelledby={`${domain.key}-title`} className="scroll-mt-28">
            <Link href={domain.url} aria-labelledby={`${domain.key}-title`} className="block h-full rounded-2xl">
              <Card className="h-full rounded-2xl shadow-none transition-colors hover:border-primary/40 [--card-spacing:--spacing(6)]">
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${tone}`}>
                    <Icon aria-hidden="true" className="size-5" strokeWidth={1.7} />
                  </span>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{domain.available ? "Общие цели" : "Планируется"}</span>
                </CardHeader>
                <CardContent>
                  <h3 id={`${domain.key}-title`} className="text-lg font-semibold tracking-tight">{domain.name.ru}</h3>
                  <p lang="en" className="mt-0.5 text-sm text-muted-foreground">{domain.name.en}</p>
                  <p className="mt-4 text-sm leading-6 text-muted-foreground">{domain.description.ru}</p>
                  <div className="mt-6 flex items-center justify-between gap-3 border-t pt-4 text-sm font-medium text-primary">
                    Открыть сферу <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          </article>
        );
      })}
    </div>
  );
}
