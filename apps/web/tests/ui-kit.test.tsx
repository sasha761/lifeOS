import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageHeader } from "../components/ui/page-header.tsx";
import { ProgressBar } from "../components/ui/progress-bar.tsx";
import { SectionCard } from "../components/ui/section-card.tsx";
import { SegmentedChoice } from "../components/ui/segmented-choice.tsx";
import { SourceLabel } from "../components/ui/source-label.tsx";
import { StatCard } from "../components/ui/stat-card.tsx";
import { StatusChip } from "../components/ui/status-chip.tsx";
import { formatGoalNumber, goalUnitLabel } from "../lib/goal-presentation.ts";
import { formatDate } from "../lib/user-preferences.ts";

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

describe("UI kit (LFS-212)", () => {
  it("PageHeader renders a single text-only h1 with the subtitle and the actions", () => {
    const markup = html(createElement(PageHeader, { title: "Финансы", description: createElement("strong", null, "6 целей."), actions: createElement("a", { href: "/goals/new" }, "Цель") }));
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup).toMatch(/<h1 class="page-title[^"]*">Финансы<\/h1>/);
    expect(markup).toContain("<strong>6 целей.</strong>");
    expect(markup).toContain('href="/goals/new"');
  });

  it("ProgressBar is a native progressbar with an accessible name, clamped value and the sphere colour", () => {
    const markup = html(createElement(ProgressBar, { value: 24, label: "Прогресс: Накопления", tone: "green" }));
    expect(markup).toMatch(/^<progress /);
    expect(markup).toContain('max="100"'); expect(markup).toContain('value="24"');
    expect(markup).toContain('aria-label="Прогресс: Накопления"');
    expect(markup).toContain("[&amp;::-webkit-progress-value]:bg-st-green");
    expect(markup).toContain("h-1.5");
    expect(html(createElement(ProgressBar, { value: 140, label: "x", size: "md" }))).toMatch(/value="100"[^>]*h-2|h-2[^>]*value="100"/);
    expect(html(createElement(ProgressBar, { value: -5, label: "x" }))).toContain('value="0"');
  });

  it("StatusChip keeps 11px chips readable: tone text only where it reaches 4.5:1, light text otherwise", () => {
    expect(html(createElement(StatusChip, { tone: "green", children: "Финансы" }))).toContain("bg-st-green/15 text-st-green");
    for (const tone of ["primary", "blue", "red"] as const) expect(html(createElement(StatusChip, { tone, children: "x" }))).toContain("text-foreground");
    expect(html(createElement(StatusChip, { tone: "outline", children: "до 31.12.2026" }))).toContain("border-border-strong");
    expect(html(createElement(StatusChip, { children: "увеличить ↑" }))).toContain('data-tone="neutral"');
  });

  it("SourceLabel hides the decorative marker and keeps the words", () => {
    const markup = html(createElement(SourceLabel, { children: "ручной ввод · 12.11.2026" }));
    expect(markup).toContain('<span aria-hidden="true" class="text-text-3">◉</span>');
    expect(markup).toContain("ручной ввод · 12.11.2026");
  });

  it("StatCard pairs the caption and the value in a description list", () => {
    const markup = html(createElement(StatCard, { label: "Старт", value: "0 NOK", hint: "01.09.2026" }));
    expect(markup).toMatch(/<dl[^>]*><dt[^>]*>Старт<\/dt><dd[^>]*>0 NOK<\/dd><dd[^>]*>01\.09\.2026<\/dd><\/dl>/);
  });

  it("SectionCard is a region named by its real heading; repeated cards can be articles with h3", () => {
    const region = html(createElement(SectionCard, { titleId: "profile-title", title: "Профиль", children: "…" }));
    expect(region).toContain('role="region"'); expect(region).toContain('aria-labelledby="profile-title"');
    expect(region).toMatch(/<h2 id="profile-title"[^>]*>Профиль<\/h2>/);
    const article = html(createElement(SectionCard, { titleId: "finance-title", title: "Финансы", role: "article", headingLevel: 3, focusableTitle: true, variant: "dashed", children: "…" }));
    expect(article).toContain('role="article"'); expect(article).toMatch(/<h3 id="finance-title" tabindex="-1"/);
    expect(article).toContain('data-variant="dashed"');
  });

  it("SegmentedChoice submits native radios with a legend and marks them invalid with a described error", () => {
    const options = [{ value: "languages", label: "Языки" }, { value: "finance", label: "Финансы" }];
    const markup = html(createElement(SegmentedChoice, { name: "domain_key", legend: "Сфера", options, defaultValue: "finance" }));
    expect(markup).toContain("<legend"); expect(markup).toContain(">Сфера</legend>");
    expect(markup.match(/type="radio"/g)).toHaveLength(2);
    expect(markup).toMatch(/<input(?=[^>]*value="finance")(?=[^>]*checked="")[^>]*>/);
    expect(markup).not.toMatch(/<input(?=[^>]*value="languages")(?=[^>]*checked="")[^>]*>/);
    const invalid = html(createElement(SegmentedChoice, { name: "domain_key", legend: "Сфера", options, error: "Выберите сферу." }));
    expect(invalid.match(/aria-invalid="true"/g)).toHaveLength(2);
    expect(invalid).toContain('aria-describedby="domain_key-error"'); expect(invalid).toContain('id="domain_key-error"');
    expect(invalid).not.toContain("checked");
  });

  it("formats goal numbers without the unit and dates without time in the user's zone", () => {
    expect(formatGoalNumber("12000", "ru").replace(/\s/g, " ")).toBe("12 000");
    expect(formatGoalNumber("9007199254740993.01", "en-GB")).toBe("9,007,199,254,740,993.01");
    expect(goalUnitLabel({ unit: "custom", unit_label: "км" })).toBe("км");
    expect(formatDate(new Date("2026-12-31T23:30:00Z"), { timezone: "Europe/Oslo", locale: "ru" })).toBe("01.01.2027");
  });
});
