import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Send } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Telegram" };

export default function TelegramPage() {
  return (
    <Card className="w-full rounded-3xl py-0 shadow-none">
      <EmptyState
        icon={Send}
        title="Telegram Mini App появится позже"
        description="Здесь будет компактное пространство LifeOS внутри Telegram. Подключение аккаунта пока недоступно."
        action={<Link href="/" className="action-link"><ArrowLeft aria-hidden="true" className="size-4" />Вернуться в LifeOS</Link>}
      />
    </Card>
  );
}
