import { BookOpen, BriefcaseBusiness, FolderKanban, Heart, Lightbulb, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DomainKey } from "@lifeos/contracts";
import type { Tone } from "./tones.ts";

/**
 * UI-only metadata. Exhaustive keys keep Web aligned with the framework-independent registry.
 * Tone (ADR-011, spec §16.2) is the sphere colour used by DomainIcon, StatusChip and ProgressBar.
 */
export const domainPresentation = {
  languages: { icon: BookOpen, tone: "primary" },
  finance: { icon: Wallet, tone: "green" },
  work: { icon: BriefcaseBusiness, tone: "blue" },
  projects: { icon: FolderKanban, tone: "amber" },
  skills: { icon: Lightbulb, tone: "cyan" },
  health: { icon: Heart, tone: "red" },
} as const satisfies Record<DomainKey, { icon: LucideIcon; tone: Tone }>;
