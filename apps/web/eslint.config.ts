import { defineConfig } from "eslint/config";
import nextPlugin from "@next/eslint-plugin-next";
import { baseConfig } from "@lifeos/config/eslint/base";
import { lifeosUiPlugin } from "./eslint-rules/no-color-literals.ts";

export default defineConfig(baseConfig, {
  files: ["**/*.{ts,tsx}"],
  plugins: { "@next/next": nextPlugin },
  settings: { next: { rootDir: import.meta.dirname } },
  rules: { ...nextPlugin.configs["core-web-vitals"].rules },
}, {
  // LFS-212: pages and components use Design System v2 tokens; colour values exist only in app/globals.css.
  files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
  plugins: { "lifeos-ui": lifeosUiPlugin },
  rules: { "lifeos-ui/no-color-literals": "error" },
});
