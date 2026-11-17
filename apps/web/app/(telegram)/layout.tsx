import type { ReactNode } from "react";
import { Brand } from "@/components/brand";

export default function TelegramLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-14 w-full max-w-xl items-center justify-between gap-4 px-4 sm:px-5">
        <Brand />
        <span className="rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">Telegram</span>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto flex w-full max-w-xl flex-1 items-center px-4 pb-12 sm:px-5">
        {children}
      </main>
    </div>
  );
}
