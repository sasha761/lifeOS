import { ArrowDown } from "lucide-react";
import { DomainCards } from "@/components/area-navigation";

export default function HomePage() {
  return (
    <>
      <section aria-labelledby="welcome-title" className="rounded-2xl border bg-card p-6 sm:p-10">
        <p className="text-sm font-medium text-muted-foreground">Мой обзор</p>
        <h1 id="welcome-title" className="mt-3 max-w-2xl text-[2rem] leading-10 font-bold tracking-[-0.02em] sm:text-[2.5rem] sm:leading-[3rem]">Важные сферы жизни.<br />В одном месте.</h1>
        <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">LifeOS объединит цели и развитие в разных направлениях. Здесь начинается ваше личное пространство.</p>
        <a href="#areas" className="action-link mt-7">Посмотреть направления <ArrowDown aria-hidden="true" className="size-4" /></a>
      </section>
      <section id="areas" aria-labelledby="areas-title" className="mt-10 scroll-mt-8">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="areas-title" className="text-[17px] leading-6 font-semibold">Сферы развития</h2>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">Шесть направлений для будущих целей и новых привычек.</p>
          </div>
          <span className="text-xs font-medium text-muted-foreground">Специализированные модули появятся позже</span>
        </div>
        <DomainCards />
      </section>
      <footer className="mt-9 flex items-center gap-2 text-xs leading-6 text-muted-foreground">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
        Сначала — пространство. Затем — ваши цели и реальные результаты.
      </footer>
    </>
  );
}
