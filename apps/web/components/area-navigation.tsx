import Link from "next/link";
import { BookOpen, BriefcaseBusiness, FolderKanban, Heart, Lightbulb, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

// Presentation-only anchor links. The domain registry belongs to Stage 2.
const areaLinks = [
  { id: "languages", label: "Languages", caption: "Языки", icon: BookOpen, tone: "bg-emerald-50 text-emerald-800" },
  { id: "finance", label: "Finance", caption: "Финансы", icon: Wallet, tone: "bg-amber-50 text-amber-800" },
  { id: "work", label: "Work", caption: "Работа", icon: BriefcaseBusiness, tone: "bg-blue-50 text-blue-800" },
  { id: "projects", label: "Projects", caption: "Проекты", icon: FolderKanban, tone: "bg-violet-50 text-violet-800" },
  { id: "skills", label: "Skills", caption: "Навыки", icon: Lightbulb, tone: "bg-orange-50 text-orange-800" },
  { id: "health", label: "Health", caption: "Здоровье", icon: Heart, tone: "bg-rose-50 text-rose-800" },
] as const;

export function AreaNavigation() {
  return (
    <nav aria-label="Сферы развития">
      <p className="mb-3 px-3 text-xs font-medium tracking-widest text-muted-foreground uppercase">Направления</p>
      <ul className="grid grid-cols-2 gap-1 min-[400px]:grid-cols-3 md:grid-cols-6 lg:grid-cols-1">
        {areaLinks.map(({ id, label, icon: Icon }) => (
          <li key={id}>
            <Link href={`/#${id}`} className="flex min-h-11 items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
              <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.7} />
              <span lang="en">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function FutureAreaCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {areaLinks.map(({ id, label, caption, icon: Icon, tone }) => (
        <article id={id} key={id} tabIndex={-1} aria-labelledby={`${id}-title`} className="scroll-mt-28 rounded-2xl target:outline-2 target:outline-offset-4 target:outline-ring">
          <Card className="h-full rounded-2xl shadow-none [--card-spacing:--spacing(6)]">
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <span className={`flex size-11 items-center justify-center rounded-xl ${tone}`}>
                <Icon aria-hidden="true" className="size-5" strokeWidth={1.7} />
              </span>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">Будущий модуль</span>
            </CardHeader>
            <CardContent>
              <h3 id={`${id}-title`} lang="en" className="text-lg font-semibold tracking-tight">{label}</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">{caption}</p>
              <div className="mt-6 flex items-center justify-between gap-3 border-t pt-4">
                <p className="text-sm text-muted-foreground">Модуль появится позже.</p>
              </div>
            </CardContent>
          </Card>
        </article>
      ))}
    </div>
  );
}
