import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DomainIcon } from "../components/ui/domain-icon.tsx";
import { SegmentedTabs } from "../components/ui/segmented-tabs.tsx";
import { domainPresentation } from "../lib/domain-presentation.ts";
import { TONES } from "../lib/tones.ts";
import { currentSectionLabel, isActivePath, SITE_SECTIONS } from "../lib/site-sections.ts";

const domains = [{ key: "finance", label: "Финансы", url: "/domains/finance" }];

describe("top bar sections (LFS-211)", () => {
  it("keeps a section active on nested paths but not on look-alike prefixes", () => {
    expect(isActivePath("/goals/4fe63a56-7a7f-4905-bdc3-c9dff1d439dc", "/goals", "prefix")).toBe(true);
    expect(isActivePath("/goals", "/goals", "prefix")).toBe(true);
    expect(isActivePath("/goalsx", "/goals", "prefix")).toBe(false);
    expect(isActivePath("/goals", "/", "prefix")).toBe(false);
    expect(isActivePath("/", "/", "exact")).toBe(true);
  });
  it("labels the current section, preferring the registry domain name", () => {
    expect(currentSectionLabel("/", domains)).toBe("Обзор");
    expect(currentSectionLabel("/goals/new", domains)).toBe("Цели");
    expect(currentSectionLabel("/domains/finance", domains)).toBe("Финансы");
    expect(currentSectionLabel("/settings", domains)).toBe("Настройки");
    expect(currentSectionLabel("/unknown", domains)).toBeNull();
  });
  it("links only to sections that exist in Stage 2", () => {
    expect(SITE_SECTIONS.map((section) => section.href)).toEqual(["/", "/goals", "/telegram", "/dashboard", "/settings"]);
  });
  it("colours every sphere with its own Design System v2 tone, painted only with token tints", () => {
    const tones = Object.values(domainPresentation).map(({ tone }) => tone);
    for (const tone of tones) expect(TONES).toContain(tone);
    expect(new Set(tones).size).toBe(tones.length);
    for (const key of Object.keys(domainPresentation) as (keyof typeof domainPresentation)[]) {
      const html = renderToStaticMarkup(createElement(DomainIcon, { domain: key }));
      expect(html).toMatch(/class="[^"]*\bbg-(primary|st-[a-z]+)\/20 text-(primary|st-[a-z]+)\b/);
      expect(html).toContain('aria-hidden="true"');
    }
  });
});

describe("SegmentedTabs", () => {
  it("renders link tabs and marks only the selected view as the current page", () => {
    const html = renderToStaticMarkup(createElement(SegmentedTabs, { label: "Статус целей", items: [
      { href: "/goals", label: "Активные", active: false },
      { href: "/goals?status=archived", label: "В архиве", active: true, count: 2 },
    ] }));
    expect(html).toContain('aria-label="Статус целей"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/<a aria-current="page"[^>]*href="\/goals\?status=archived"/);
    expect(html).toContain(">2</span>");
  });
});
