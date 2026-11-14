import type { ReactNode } from "react";
import { Brand } from "@/components/brand";

export default function TelegramLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-secondary/30">
      <header className="mx-auto flex min-h-20 w-full max-w-xl items-center justify-between gap-4 px-5">
        <Brand />
        <span className="rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">Telegram</span>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto flex w-full max-w-xl flex-1 items-center px-5 pb-12">
        {children}
      </main>
    </div>
  );
}
