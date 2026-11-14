import { ArrowDown, Sprout } from "lucide-react";
import { FutureAreaCards } from "@/components/area-navigation";

export default function HomePage() {
  return (
    <>
      <p className="mb-5 text-sm font-medium text-muted-foreground">Мой обзор</p>
      <section aria-labelledby="welcome-title" className="relative isolate overflow-hidden rounded-3xl bg-primary p-7 text-primary-foreground sm:p-10">
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-24 -z-10 size-96 rounded-full border-52 border-white/4" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-5 -bottom-44 -z-10 size-96 rounded-full border border-white/10" />
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 text-xs font-medium text-white/90">
          <Sprout aria-hidden="true" className="size-3.5" /> Пространство для роста
        </span>
        <h1 id="welcome-title" className="max-w-xl text-3xl leading-[1.14] font-semibold tracking-[-0.035em] sm:text-[2.75rem]">Важные сферы жизни.<br />В одном месте.</h1>
        <p className="mt-5 max-w-md text-sm leading-7 text-white/80 sm:text-base">LifeOS объединит цели и развитие в разных направлениях. Здесь начинается ваше личное пространство.</p>
        <a href="#areas" className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-white/90 focus-visible:outline-white">
          Посмотреть направления <ArrowDown aria-hidden="true" className="size-4" />
        </a>
      </section>
      <section id="areas" aria-labelledby="areas-title" className="mt-10 scroll-mt-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="areas-title" className="text-xl font-semibold tracking-tight">Сферы развития</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Шесть направлений для будущих целей и новых привычек.</p>
          </div>
          <span className="text-xs font-medium text-muted-foreground">Модули ещё не доступны</span>
        </div>
        <FutureAreaCards />
      </section>
      <footer className="mt-9 flex items-center gap-2 text-xs leading-6 text-muted-foreground">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-primary/50" />
        Сначала — пространство. Затем — ваши цели и реальные результаты.
      </footer>
    </>
  );
}
