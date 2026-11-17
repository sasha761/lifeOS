import { BookOpen, BriefcaseBusiness, FolderKanban, Heart, Lightbulb, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DomainKey } from "@lifeos/contracts";

/**
 * UI-only metadata. Exhaustive keys keep Web aligned with the framework-independent registry.
 * Tone (ADR-011, spec §16.2): the icon takes the sphere colour on a 15% tint of the same colour.
 */
export const domainPresentation = {
  languages: { icon: BookOpen, tone: "bg-primary/15 text-primary" },
  finance: { icon: Wallet, tone: "bg-st-green/15 text-st-green" },
  work: { icon: BriefcaseBusiness, tone: "bg-st-blue/15 text-st-blue" },
  projects: { icon: FolderKanban, tone: "bg-st-amber/15 text-st-amber" },
  skills: { icon: Lightbulb, tone: "bg-st-cyan/15 text-st-cyan" },
  health: { icon: Heart, tone: "bg-st-red/15 text-st-red" },
} satisfies Record<DomainKey, { icon: LucideIcon; tone: string }>;
