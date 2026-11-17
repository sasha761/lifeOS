"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { RefObject } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, Compass, LayoutGrid, Menu, Send, Settings, Target, UserRound, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DomainKey } from "@lifeos/contracts";
import { Brand } from "@/components/brand";
import { NavigationLink } from "@/components/navigation-link";
import { domainPresentation } from "@/lib/domain-presentation";
import { currentSectionLabel, isActivePath, SITE_SECTIONS } from "@/lib/site-sections";
import type { NavDomain } from "@/lib/site-sections";

const icons: Record<(typeof SITE_SECTIONS)[number]["href"], LucideIcon> = {
  "/": LayoutGrid, "/goals": Target, "/telegram": Send, "/dashboard": UserRound, "/settings": Settings,
};
const [overview, goals, ...rest] = SITE_SECTIONS;
const settings = rest.find((section) => section.href === "/settings")!;
const trailing = rest.filter((section) => section.href !== "/settings");

/** Closes a disclosure on Escape (returning focus to its toggle) and on a pointer press outside it. */
function useDismiss(open: boolean, close: () => void, container: RefObject<HTMLElement | null>, toggle: RefObject<HTMLButtonElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { close(); toggle.current?.focus(); } };
    const onPointer = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) close(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onPointer); };
  }, [open, close, container, toggle]);
}

function DomainLinks({ domains, onNavigate }: { domains: readonly NavDomain[]; onNavigate(): void }) {
  return (
    <ul className="grid gap-0.5">
      {domains.map((domain) => {
        const { icon: Icon, tone } = domainPresentation[domain.key as DomainKey];
        return (
          <li key={domain.key}>
            <NavigationLink href={domain.url} match="prefix" onNavigate={onNavigate}>
              <span aria-hidden="true" className={`flex size-7 shrink-0 items-center justify-center rounded-md ${tone}`}><Icon className="size-4" strokeWidth={1.8} /></span>
              {domain.label}
            </NavigationLink>
          </li>
        );
      })}
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
      <div className="mx-auto flex h-14 max-w-[1180px] items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Brand />
          {label && <span className="truncate text-sm text-muted-foreground"><span aria-hidden="true">· </span>{label}</span>}
        </div>
        <nav aria-label="Основная навигация" className="hidden items-center gap-2 lg:flex">
          {[overview, goals].map((section) => {
            const Icon = icons[section.href];
            return <NavigationLink key={section.href} href={section.href} match={section.match} variant="pill"><Icon aria-hidden="true" className="size-4" />{section.label}</NavigationLink>;
          })}
          <div ref={domainsBox} className="relative">
            <button ref={domainsToggle} type="button" aria-expanded={domainsOpen} aria-controls={domainsId} onClick={() => setDomainsOpen((open) => !open)}
              className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors duration-[120ms] ${domainActive || domainsOpen ? "border-border-strong bg-secondary text-foreground" : "border-border text-muted-foreground hover:border-border-strong hover:bg-surface-3 hover:text-foreground"}`}>
              <Compass aria-hidden="true" className="size-4" />Сферы<ChevronDown aria-hidden="true" className={`size-4 transition-transform duration-[180ms] ${domainsOpen ? "rotate-180" : ""}`} />
            </button>
            <div id={domainsId} hidden={!domainsOpen} className="absolute top-full right-0 z-40 mt-2 w-64 rounded-[14px] border bg-card p-2 shadow-[0_8px_24px_rgb(0_0_0/0.35)]">
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
      <nav id={sheetId} aria-label="Мобильная навигация" hidden={!sheetOpen} className="mx-4 mb-3 rounded-[14px] border bg-card p-2 shadow-[0_8px_24px_rgb(0_0_0/0.35)] sm:mx-6 lg:hidden">
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
