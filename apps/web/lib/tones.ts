/**
 * Semantic colours of Design System v2 (ADR-011, docs/UI_GUIDELINES.md §2): `primary` and the status tokens
 * `st-*` from globals.css. Components map a tone to static Tailwind classes; colour values live only in globals.css.
 */
export const TONES = ["primary", "green", "blue", "amber", "orange", "red", "cyan", "gray"] as const;
export type Tone = (typeof TONES)[number];
