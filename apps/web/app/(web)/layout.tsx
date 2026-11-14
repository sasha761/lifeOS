import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, LayoutGrid } from "lucide-react";
import { Brand } from "@/components/brand";
import { AreaNavigation } from "@/components/area-navigation";

export default function WebLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b bg-card">
        <div className="mx-auto flex min-h-20 max-w-360 items-center justify-between gap-4 px-5 sm:px-8">
          <Brand />
          <Link href="/telegram" className="action-link-secondary">
            Telegram <ArrowUpRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-360 lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="border-b px-3 py-5 lg:min-h-[calc(100dvh-81px)] lg:border-r lg:border-b-0 lg:px-5 lg:py-8">
          <div className="lg:sticky lg:top-8">
            <Link href="/" aria-current="page" className="mb-7 hidden min-h-11 items-center gap-2 rounded-lg bg-secondary px-3 py-2.5 text-sm font-semibold text-primary lg:flex">
              <LayoutGrid aria-hidden="true" className="size-4" /> Обзор
            </Link>
            <AreaNavigation />
            <p className="mt-12 hidden border-t px-3 pt-5 text-xs leading-6 text-muted-foreground lg:block">Ваш ритм.<br />Ваш путь развития.</p>
          </div>
        </aside>
        <main id="main-content" tabIndex={-1} className="min-w-0 px-5 pt-7 pb-10 sm:px-8 lg:pt-9 lg:pb-14">
          {children}
        </main>
      </div>
    </div>
  );
}
