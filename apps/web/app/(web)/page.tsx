import { DomainCards } from "@/components/area-navigation";
import { PageHeader } from "@/components/ui/page-header";

// Public overview: layout of mockup 04 (title with a bold lead, then sections), no personal numbers for guests.
export default function HomePage() {
  return (
    <>
      <PageHeader title="Обзор"
        description={<><strong>Важные сферы жизни. В одном месте.</strong> LifeOS объединит цели и развитие в разных направлениях. Здесь начинается ваше личное пространство.</>} />
      <section id="areas" aria-labelledby="areas-title" className="mt-6 scroll-mt-8">
        <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="areas-title" className="text-base leading-[22px] font-bold">Сферы развития</h2>
          <p className="text-xs text-muted-foreground">Шесть направлений для целей и новых привычек; специализированные модули появятся позже</p>
        </div>
        <DomainCards />
      </section>
      <footer className="mt-8 flex items-center gap-2 text-xs leading-6 text-muted-foreground">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
        Сначала — пространство. Затем — ваши цели и реальные результаты.
      </footer>
    </>
  );
}
