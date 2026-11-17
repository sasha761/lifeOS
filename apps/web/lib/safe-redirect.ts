export const DEFAULT_SIGNED_IN_PATH = "/dashboard";
const base = "http://lifeos.invalid";

/**
 * Same-origin path for post-sign-in navigation. Anything that could leave the site
 * (absolute or protocol-relative URLs, backslashes, control characters) or loop back
 * into auth/API routes falls back to the dashboard.
 */
export function safeRedirectPath(value: unknown, fallback: string = DEFAULT_SIGNED_IN_PATH): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return fallback;
  }
  if (url.origin !== base || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/")) return fallback;
  return `${url.pathname}${url.search}`;
}
