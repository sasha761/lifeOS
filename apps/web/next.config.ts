import { resolve } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root: resolve(import.meta.dirname, "../..") },
};

export default nextConfig;
