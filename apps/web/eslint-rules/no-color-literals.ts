import type { ESLint, Rule } from "eslint";

/*
 * LFS-212, docs/UI_GUIDELINES.md §3: colours live only in apps/web/app/globals.css. In components and pages a
 * colour literal — `#rgb`/`#rrggbb`/`#rrggbbaa` or a colour function — is an error, including inside Tailwind
 * arbitrary values such as `bg-[#8B7CF6]` or `shadow-[0_8px_24px_rgb(0_0_0/0.35)]`.
 * Known false positive: an in-page anchor made only of hex letters (`#add`); rename the anchor.
 */
const HEX_COLOR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z_-])/i;
const COLOR_FUNCTION = /(?<![a-z])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/i;

/** The first colour literal in a string, or null. */
export function findColorLiteral(text: string): string | null {
  return (HEX_COLOR.exec(text) ?? COLOR_FUNCTION.exec(text))?.[0] ?? null;
}

const noColorLiterals: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow colour literals outside apps/web/app/globals.css (Design System v2 tokens only)." },
    schema: [],
    messages: {
      colorLiteral: "Цвет «{{value}}» в компоненте запрещён: используйте токен из apps/web/app/globals.css (bg-card, text-muted-foreground, bg-st-green/15 …), см. docs/UI_GUIDELINES.md §2–3.",
    },
  },
  create(context) {
    function check(node: Rule.Node, text: string) {
      const value = findColorLiteral(text);
      if (value) context.report({ node, messageId: "colorLiteral", data: { value } });
    }
    return {
      Literal(node) { if (typeof node.value === "string") check(node, node.value); },
      TemplateElement(node) { check(node, node.value.cooked ?? node.value.raw); },
    };
  },
};

export const lifeosUiPlugin: ESLint.Plugin = { meta: { name: "lifeos-ui" }, rules: { "no-color-literals": noColorLiterals } };
