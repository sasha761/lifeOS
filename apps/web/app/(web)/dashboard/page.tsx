import type { Metadata } from "next";
import Link from "next/link";
import { LayoutGrid, Settings } from "lucide-react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Card, CardContent } from "@/components/ui/card";
import { requirePageSession } from "@/server/auth";
import { getUserPreferencesService } from "@/server/core";

export const metadata: Metadata = { title: "Мой кабинет" };

export default async function DashboardPage() {
  const { user, actor } = await requirePageSession("/dashboard");
  const preferences = await getUserPreferencesService().get(actor);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Мой кабинет</p>
          <h1 className="page-title mt-1 wrap-anywhere">Здравствуйте, {user.name}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Вы вошли как <span className="font-medium text-foreground">{user.email}</span>.</p>
          <p className="text-sm leading-6 text-muted-foreground">Часовой пояс: <span className="font-medium text-foreground">{preferences.timezone}</span>.</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <Link href="/settings" className="action-link-secondary">
            <Settings aria-hidden="true" className="size-4" /> Настройки
          </Link>
          <SignOutButton />
        </div>
      </div>
      <Card className="mt-8 rounded-2xl shadow-none [--card-spacing:--spacing(6)]">
        <CardContent className="flex flex-col items-start gap-4 sm:flex-row">
          <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-primary/15 text-primary">
            <LayoutGrid className="size-5" strokeWidth={1.7} />
          </span>
          <div>
            <h2 className="text-[17px] leading-6 font-semibold">Обзор сфер появится позже</h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              Ручные цели и измерения уже доступны в разделе целей. Обзор по всем шести сферам появится в отдельной задаче.
              Здесь пока нет общих показателей — и нет придуманных процентов.
            </p>
            <Link href="/goals" className="action-link mt-4">Мои цели</Link>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
