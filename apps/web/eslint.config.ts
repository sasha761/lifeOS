import { defineConfig } from "eslint/config";
import nextPlugin from "@next/eslint-plugin-next";
import { baseConfig } from "@lifeos/config/eslint/base";

export default defineConfig(baseConfig, {
  files: ["**/*.{ts,tsx}"],
  plugins: { "@next/next": nextPlugin },
  settings: { next: { rootDir: import.meta.dirname } },
  rules: { ...nextPlugin.configs["core-web-vitals"].rules },
});
