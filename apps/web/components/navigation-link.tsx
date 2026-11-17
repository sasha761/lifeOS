"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavigationLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  const active = usePathname() === href;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-11 items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors ${active ? "bg-secondary font-semibold text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"} ${className}`}
    >
      {children}
    </Link>
  );
}
