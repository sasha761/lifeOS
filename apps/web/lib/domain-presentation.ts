import { BookOpen, BriefcaseBusiness, FolderKanban, Heart, Lightbulb, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DomainKey } from "@lifeos/contracts";

/** UI-only metadata. Exhaustive keys keep Web aligned with the framework-independent registry. */
export const domainPresentation = {
  languages: { icon: BookOpen, tone: "bg-emerald-50 text-emerald-800" },
  finance: { icon: Wallet, tone: "bg-amber-50 text-amber-800" },
  work: { icon: BriefcaseBusiness, tone: "bg-blue-50 text-blue-800" },
  projects: { icon: FolderKanban, tone: "bg-violet-50 text-violet-800" },
  skills: { icon: Lightbulb, tone: "bg-orange-50 text-orange-800" },
  health: { icon: Heart, tone: "bg-rose-50 text-rose-800" },
} satisfies Record<DomainKey, { icon: LucideIcon; tone: string }>;
