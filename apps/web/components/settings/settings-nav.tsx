"use client";

import { useEffect, useState } from "react";

export type SettingsSection = { id: string; label: string };

/**
 * Section menu of /settings (mockup 16, 220px column): anchors to the sections on the page. The section in view is
 * marked with `aria-current="location"`. Only sections that exist are listed; Telegram (stage 3) and privacy (stage 8)
 * join with their tasks. On narrow screens the same links sit in a row above the sections.
 */
export function SettingsNav({ sections }: { sections: SettingsSection[] }) {
  const [current, setCurrent] = useState(sections[0]?.id);
  useEffect(() => {
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting);
      const first = sections.find((section) => visible.get(section.id));
      if (first) setCurrent(first.id);
    }, { rootMargin: "-20% 0px -60% 0px" });
    for (const section of sections) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [sections]);
  return <nav aria-label="Разделы настроек" className="lg:sticky lg:top-4 lg:self-start">
    <ul className="flex gap-1 overflow-x-auto lg:grid">
      {sections.map((section) => {
        const active = section.id === current;
        return <li key={section.id} className="shrink-0">
          <a href={`#${section.id}`} aria-current={active ? "location" : undefined} onClick={() => setCurrent(section.id)}
            className={`flex min-h-11 items-center rounded-[10px] border px-3 text-[13px] transition-colors duration-[120ms] pointer-fine:min-h-8 ${active
              ? "border-border-strong bg-surface-2 font-semibold text-foreground" : "border-transparent text-muted-foreground hover:bg-surface-3 hover:text-foreground"}`}>
            {section.label}</a>
        </li>;
      })}
    </ul>
  </nav>;
}
