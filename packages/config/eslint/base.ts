import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export const baseConfig = defineConfig(
  globalIgnores(["**/.next/**", "**/node_modules/**", "**/dist/**", "**/next-env.d.ts"]),
  tseslint.configs.recommended,
  {
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: { "@typescript-eslint/consistent-type-imports": "error" },
  },
);
