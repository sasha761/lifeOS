"use client";

import { useCallback, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, Compass, LayoutGrid, Menu, Send, Settings, Target, UserRound, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DomainKey } from "@lifeos/contracts";
import { Brand } from "@/components/brand";
import { NavigationLink } from "@/components/navigation-link";
import { DomainIcon } from "@/components/ui/domain-icon";
import { currentSectionLabel, isActivePath, SITE_SECTIONS } from "@/lib/site-sections";
import { useDismiss } from "@/lib/use-dismiss";
import type { NavDomain } from "@/lib/site-sections";

const icons: Record<(typeof SITE_SECTIONS)[number]["href"], LucideIcon> = {
  "/": LayoutGrid, "/goals": Target, "/telegram": Send, "/dashboard": UserRound, "/settings": Settings,
};
const [overview, goals, ...rest] = SITE_SECTIONS;
const settings = rest.find((section) => section.href === "/settings")!;
const trailing = rest.filter((section) => section.href !== "/settings");

function DomainLinks({ domains, onNavigate }: { domains: readonly NavDomain[]; onNavigate(): void }) {
  return (
    <ul className="grid gap-0.5">
      {domains.map((domain) => (
        <li key={domain.key}>
          <NavigationLink href={domain.url} match="prefix" onNavigate={onNavigate}>
            <DomainIcon domain={domain.key as DomainKey} size="sm" />
            {domain.label}
          </NavigationLink>
        </li>
      ))}
    </ul>
  );
}

export function SiteNav({ domains }: { domains: readonly NavDomain[] }) {
  const pathname = usePathname();
  const label = currentSectionLabel(pathname, domains);
  const [domainsOpen, setDomainsOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const domainsBox = useRef<HTMLDivElement>(null);
  const domainsToggle = useRef<HTMLButtonElement>(null);
  const sheetBox = useRef<HTMLDivElement>(null);
  const sheetToggle = useRef<HTMLButtonElement>(null);
  const domainsId = useId();
  const sheetId = useId();
  const closeDomains = useCallback(() => setDomainsOpen(false), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  useDismiss(domainsOpen, closeDomains, domainsBox, domainsToggle);
  useDismiss(sheetOpen, closeSheet, sheetBox, sheetToggle);
  const domainActive = isActivePath(pathname, "/domains", "prefix");

  return (
    <div ref={sheetBox}>
      <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-7">
        <div className="flex min-w-0 items-center gap-2">
          <Brand />
          {label && <span className="truncate text-[13px] text-muted-foreground"><span aria-hidden="true">/ </span>{label}</span>}
        </div>
        <nav aria-label="Основная навигация" className="hidden items-center gap-2 lg:flex">
          {[overview, goals].map((section) => {
            const Icon = icons[section.href];
            return <NavigationLink key={section.href} href={section.href} match={section.match} variant="pill"><Icon aria-hidden="true" className="size-4" />{section.label}</NavigationLink>;
          })}
          <div ref={domainsBox} className="relative">
            <button ref={domainsToggle} type="button" aria-expanded={domainsOpen} aria-controls={domainsId} onClick={() => setDomainsOpen((open) => !open)}
              className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors duration-[120ms] pointer-fine:min-h-8 ${domainActive || domainsOpen ? "border-border-strong bg-surface-2 font-semibold text-foreground" : "border-border text-muted-foreground hover:border-border-strong hover:bg-surface-3 hover:text-foreground"}`}>
              <Compass aria-hidden="true" className="size-3.5" />Сферы<ChevronDown aria-hidden="true" className={`size-4 transition-transform duration-[180ms] ${domainsOpen ? "rotate-180" : ""}`} />
            </button>
            <div id={domainsId} hidden={!domainsOpen} className="absolute top-full right-0 z-40 mt-2 w-64 rounded-[14px] border bg-card p-2 shadow-popover">
              <DomainLinks domains={domains} onNavigate={closeDomains} />
            </div>
          </div>
          {trailing.map((section) => {
            const Icon = icons[section.href];
            return <NavigationLink key={section.href} href={section.href} match={section.match} variant="pill"><Icon aria-hidden="true" className="size-4" />{section.label}</NavigationLink>;
          })}
          <NavigationLink href={settings.href} match={settings.match} variant="pillIcon" label={settings.label}>
            <Settings aria-hidden="true" className="size-4" />
          </NavigationLink>
        </nav>
        <button ref={sheetToggle} type="button" aria-expanded={sheetOpen} aria-controls={sheetId} onClick={() => setSheetOpen((open) => !open)}
          className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium text-foreground transition-colors duration-[120ms] hover:border-border-strong hover:bg-surface-3 lg:hidden">
          {sheetOpen ? <X aria-hidden="true" className="size-4" /> : <Menu aria-hidden="true" className="size-4" />}Меню
        </button>
      </div>
      <nav id={sheetId} aria-label="Мобильная навигация" hidden={!sheetOpen} className="mx-4 mb-3 rounded-[14px] border bg-card p-2 shadow-popover sm:mx-6 lg:hidden">
        <ul className="grid gap-0.5">
          {SITE_SECTIONS.map((section) => {
            const Icon = icons[section.href];
            return <li key={section.href}><NavigationLink href={section.href} match={section.match} onNavigate={closeSheet}><Icon aria-hidden="true" className="size-4 shrink-0" />{section.label}</NavigationLink></li>;
          })}
        </ul>
        <p className="mt-3 mb-1 px-3 text-xs font-semibold text-muted-foreground">Сферы</p>
        <DomainLinks domains={domains} onNavigate={closeSheet} />
      </nav>
    </div>
  );
}
