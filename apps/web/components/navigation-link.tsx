"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActivePath } from "@/lib/site-sections";
import type { SectionMatch } from "@/lib/site-sections";

const variants = {
  /** Top bar pill (spec §16.4): the active section is lighter. */
  pill: (active: boolean) => `inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors duration-[120ms] ${active ? "border-border-strong bg-secondary text-foreground" : "border-border text-muted-foreground hover:border-border-strong hover:bg-surface-3 hover:text-foreground"}`,
  /** Icon-only pill (settings gear); needs `label`. */
  pillIcon: (active: boolean) => `inline-flex size-10 shrink-0 items-center justify-center rounded-full border transition-colors duration-[120ms] ${active ? "border-border-strong bg-secondary text-foreground" : "border-border text-muted-foreground hover:border-border-strong hover:bg-surface-3 hover:text-foreground"}`,
  /** Rows inside the domains menu and the mobile sheet. */
  menu: (active: boolean) => `flex min-h-11 items-center gap-3 rounded-[10px] px-3 py-2 text-sm transition-colors duration-[120ms] ${active ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground hover:bg-surface-3 hover:text-foreground"}`,
};

export function NavigationLink({ href, children, className = "", variant = "menu", match = "exact", label, onNavigate }: {
  href: string;
  children: ReactNode;
  className?: string;
  variant?: keyof typeof variants;
  match?: SectionMatch;
  /** Accessible name for icon-only links. */
  label?: string;
  onNavigate?: () => void;
}) {
  const active = isActivePath(usePathname(), href, match);
  return (
    <Link href={href} aria-label={label} aria-current={active ? "page" : undefined} onClick={onNavigate} className={`${variants[variant](active)} ${className}`}>
      {children}
    </Link>
  );
}
