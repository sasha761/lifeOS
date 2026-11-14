import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

export default function NotFound() {
  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-dvh items-center justify-center">
      <EmptyState
        icon={Compass}
        title="Страница не найдена"
        description="Возможно, адрес изменился. Вернитесь на главную, чтобы выбрать направление."
        action={<Link href="/" className="action-link"><ArrowLeft aria-hidden="true" className="size-4" />На главную</Link>}
      />
    </main>
  );
}
