import { fileURLToPath } from "node:url";
import { ESLint, Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { findColorLiteral, lifeosUiPlugin } from "../eslint-rules/no-color-literals.ts";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const linter = new Linter({ configType: "flat" });
const config = [{
  files: ["**/*.tsx"],
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { "lifeos-ui": lifeosUiPlugin },
  rules: { "lifeos-ui/no-color-literals": "error" as const },
}];
const problems = (code: string) => linter.verify(code, config, { filename: "component.tsx" });

describe("lifeos-ui/no-color-literals (LFS-212)", () => {
  it.each([
    ["#8B7CF6", "#8B7CF6"], ["bg-[#8b7cf6]", "#8b7cf6"], ["text-[#fff]", "#fff"], ["border-[#37304780]", "#37304780"], ["#FFF8", "#FFF8"],
    ["shadow-[0_8px_24px_rgb(0_0_0/0.35)]", "rgb("], ["rgba(1,2,3,.5)", "rgba("], ["oklch(0.7 0.1 270)", "oklch("], ["hsl(250 80% 70%)", "hsl("],
    ["color-mix(in oklab, red, blue)", "color-mix("],
  ])("finds the colour literal in %s", (text, found) => { expect(findColorLiteral(text)).toBe(found); });

  it.each(["bg-card text-muted-foreground", "bg-st-green/15 text-st-green", "#areas", "#main-content", "/goals?domain_key=finance#top", "text-[13px] leading-[22px]", "Collab(2)"])(
    "ignores tokens, anchors and plain text: %s", (text) => { expect(findColorLiteral(text)).toBeNull(); });

  it("reports class names, template literals and inline styles with a message pointing to the tokens", () => {
    const found = problems(`export const A = () => <div className="rounded-2xl bg-[#1F1A2A]" style={{ color: "rgb(0 0 0)" }}>{\`ring-[\${"x"}] text-[#F2EDF8]\`}</div>;`);
    expect(found).toHaveLength(3);
    for (const problem of found) {
      expect(problem.ruleId).toBe("lifeos-ui/no-color-literals");
      expect(problem.message).toContain("apps/web/app/globals.css");
    }
    expect(problems(`export const B = () => <a href="#areas" className="bg-card text-st-green">Сферы</a>;`)).toEqual([]);
  });

  it("is wired into the web ESLint config for components and pages only", async () => {
    const eslint = new ESLint({ cwd: webRoot });
    const code = `export const Bad = () => <span className="text-[#8B7CF6]">x</span>;\n`;
    const ruleHits = async (path: string) => (await eslint.lintText(code, { filePath: `${webRoot}${path}` }))[0]!.messages
      .filter((message) => message.ruleId === "lifeos-ui/no-color-literals");
    expect(await ruleHits("components/example-color.tsx")).toHaveLength(1);
    expect(await ruleHits("app/(web)/example/page.tsx")).toHaveLength(1);
    expect(await ruleHits("tests/example-color.tsx")).toHaveLength(0);
  }, 60_000);
});
