"use client";

import { RotateCcw, Unplug } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-dvh items-center justify-center">
      <EmptyState
        icon={Unplug}
        title="Не удалось открыть страницу"
        description="Попробуйте загрузить её ещё раз."
        action={<button type="button" onClick={reset} className="action-link"><RotateCcw aria-hidden="true" className="size-4" />Попробовать снова</button>}
      />
    </main>
  );
}
