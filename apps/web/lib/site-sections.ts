/** Plain navigation data shared by the server layout and the client header (no icons, no registry imports). */
export type NavDomain = { key: string; label: string; url: string };

/** Top-level sections that exist today; future modules (Tasks, Projects, Assistant) are added with their stages. */
export const SITE_SECTIONS = [
  { href: "/", label: "Обзор", match: "exact" },
  { href: "/goals", label: "Цели", match: "prefix" },
  { href: "/telegram", label: "Telegram", match: "prefix" },
  { href: "/dashboard", label: "Кабинет", match: "prefix" },
  { href: "/settings", label: "Настройки", match: "prefix" },
] as const satisfies readonly { href: string; label: string; match: "exact" | "prefix" }[];

export type SectionMatch = "exact" | "prefix";

/** `/goals/123` keeps «Цели» active; `/goalsx` does not. */
export function isActivePath(pathname: string, href: string, match: SectionMatch): boolean {
  if (match === "exact" || href === "/") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Label shown next to the logo; domain pages show the domain name from the registry. */
export function currentSectionLabel(pathname: string, domains: readonly NavDomain[]): string | null {
  const domain = domains.find((item) => isActivePath(pathname, item.url, "prefix"));
  if (domain) return domain.label;
  if (isActivePath(pathname, "/domains", "prefix")) return "Сферы";
  return SITE_SECTIONS.find((section) => isActivePath(pathname, section.href, section.match))?.label ?? null;
}
