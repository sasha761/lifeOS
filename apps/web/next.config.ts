import { resolve } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root: resolve(import.meta.dirname, "../..") },
  // Next 16.4 dev matches routes strictly: the `@modal/[...catchAll]` slot of `(web)` (LFS-212) is added to every URL,
  // and pages outside `(web)` — `(auth)`, `(telegram)`, `(onboarding)` — were dropped as incomplete routes (404 in dev only).
  // Loose matching is what the production build already uses, where all of these routes are tested (LFS-219).
  deprecated: { looseRouteMatching: true },
};

export default nextConfig;
