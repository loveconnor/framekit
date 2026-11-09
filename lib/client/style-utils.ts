import { formatHex, formatHex8, parse } from "culori";
import type { Breakpoint, StyleRules, StyleSheetModel } from "@/types/elements";

export const BREAKPOINT_ORDER: Breakpoint[] = ["desktop", "tablet", "mobile"];

/** The override that applies at `viewport` after Framekit's desktop-first cascade. */
export function effectiveOverride(rules: StyleRules | undefined, viewport: Breakpoint, property: string): { value: string; from: Breakpoint } | null {
  if (!rules) return null;
  const index = BREAKPOINT_ORDER.indexOf(viewport);
  for (let i = index; i >= 0; i--) {
    const bp = BREAKPOINT_ORDER[i];
    const value = rules[bp]?.[property];
    if (value !== undefined) return { value, from: bp };
  }
  return null;
}

export function rulesFor(styles: StyleSheetModel, styleId: string | null): StyleRules | undefined {
  return styleId ? styles[styleId] : undefined;
}

export type Length = { number: number; unit: string } | { keyword: string };

export function parseLength(raw: string | undefined | null): Length | null {
  if (!raw) return null;
  const value = raw.trim();
  if (value === "") return null;
  const match = value.match(/^(-?\d*\.?\d+)([a-z%]*)$/i);
  if (match) return { number: Number(match[1]), unit: match[2] || "" };
  return { keyword: value };
}

export function formatLength(number: number, unit: string): string {
  const rounded = Math.round(number * 100) / 100;
  return `${rounded}${unit}`;
}

/** Computed colors arrive as rgb(), lab(), oklch() and friends; show hex (with alpha when needed). */
export function toHex(color: string | undefined | null): string {
  if (!color) return "";
  const trimmed = color.trim();
  if (trimmed === "transparent" || trimmed === "rgba(0, 0, 0, 0)") return "transparent";
  const parsed = parse(trimmed);
  if (!parsed) return trimmed;
  const alpha = parsed.alpha ?? 1;
  if (alpha === 0) return "transparent";
  return alpha < 1 ? formatHex8(parsed) : formatHex(parsed);
}

export function primaryFontFamily(value: string | undefined): string {
  if (!value) return "";
  return value.split(",")[0]?.trim().replace(/^["']|["']$/g, "") ?? "";
}

export function displayFile(file: string): string {
  return file.replace(/^src\//, "");
}

/* ------------------------------------------------------------------ */
/* Composite value parsers for the Effects and Backgrounds sections     */
/* ------------------------------------------------------------------ */

/** Split on `separator` at paren depth zero, so `rgb(0, 0, 0)` survives a comma split. */
export function splitTopLevel(value: string, separator: "," | " "): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && (separator === "," ? ch === "," : /\s/.test(ch))) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export type Shadow = { inset: boolean; x: string; y: string; blur: string; spread: string; color: string };

/** First shadow of a `box-shadow` value, in either author order (`x y blur spread color`) or computed order (`color x y ...`). */
export function parseShadow(value: string | undefined | null): Shadow | null {
  if (!value || value.trim() === "none") return null;
  const first = splitTopLevel(value, ",")[0];
  if (!first) return null;
  const tokens = splitTopLevel(first, " ");
  const lengths: string[] = [];
  let color = "";
  let inset = false;
  for (const token of tokens) {
    if (token === "inset") inset = true;
    else if (/^-?\d/.test(token) || /^-?\.\d/.test(token)) lengths.push(token);
    else color = token;
  }
  if (lengths.length < 2) return null;
  return { inset, x: lengths[0], y: lengths[1], blur: lengths[2] ?? "0px", spread: lengths[3] ?? "0px", color: toHex(color) || "rgba(0,0,0,0.12)" };
}

export function formatShadow(shadow: Shadow): string {
  return `${shadow.inset ? "inset " : ""}${shadow.x} ${shadow.y} ${shadow.blur} ${shadow.spread} ${shadow.color}`;
}

export type Gradient = { angle: number; from: string; to: string };

const DIRECTION_ANGLES: Record<string, number> = { "to top": 0, "to right": 90, "to bottom": 180, "to left": 270 };

/** Two-stop `linear-gradient(<angle>, <from>, <to>)`; anything fancier returns null. */
export function parseGradient(value: string | undefined | null): Gradient | null {
  if (!value) return null;
  const match = value.trim().match(/^linear-gradient\(([\s\S]*)\)$/);
  if (!match) return null;
  const parts = splitTopLevel(match[1], ",");
  let angle = 180;
  if (parts.length === 3) {
    const head = parts.shift()!;
    const deg = head.match(/^(-?\d*\.?\d+)deg$/);
    if (deg) angle = Number(deg[1]);
    else if (head in DIRECTION_ANGLES) angle = DIRECTION_ANGLES[head];
    else return null;
  }
  if (parts.length !== 2) return null;
  const stop = (raw: string) => toHex(splitTopLevel(raw, " ")[0]) || raw;
  return { angle, from: stop(parts[0]), to: stop(parts[1]) };
}

export function formatGradient(gradient: Gradient): string {
  return `linear-gradient(${gradient.angle}deg, ${gradient.from}, ${gradient.to})`;
}

/** The `url(...)` path of a background-image, when it has exactly one. */
export function parseImageUrl(value: string | undefined | null): string | null {
  if (!value) return null;
  const match = value.match(/url\(\s*(['"]?)([^'")]+)\1\s*\)/);
  return match ? match[2] : null;
}

export type Transform = { x: string; y: string; scale: string; rotate: string };

/** Framekit writes transforms as `translate(x, y) scale(s) rotate(r)`; computed matrices come back as null. */
export function parseTransform(value: string | undefined | null): Transform | null {
  if (!value || value.trim() === "none" || value.includes("matrix")) return null;
  const t: Transform = { x: "0px", y: "0px", scale: "1", rotate: "0deg" };
  const translate = value.match(/translate\(\s*([^,)]+)\s*,\s*([^)]+)\)/);
  if (translate) {
    t.x = translate[1].trim();
    t.y = translate[2].trim();
  }
  const scale = value.match(/scale\(\s*([^)]+)\)/);
  if (scale) t.scale = scale[1].trim();
  const rotate = value.match(/rotate\(\s*([^)]+)\)/);
  if (rotate) t.rotate = rotate[1].trim();
  return t;
}

export function formatTransform(t: Transform): string | null {
  const parts: string[] = [];
  const zero = (v: string) => /^-?0(\.0+)?([a-z%]*)$/.test(v.trim());
  if (!zero(t.x) || !zero(t.y)) parts.push(`translate(${t.x}, ${t.y})`);
  if (t.scale.trim() !== "1") parts.push(`scale(${t.scale})`);
  if (!zero(t.rotate)) parts.push(`rotate(${t.rotate})`);
  return parts.length ? parts.join(" ") : null;
}

export type Transition = { duration: string; easing: string };

export function parseTransition(value: string | undefined | null): Transition | null {
  if (!value || value.trim() === "none" || value.trim() === "") return null;
  const tokens = splitTopLevel(splitTopLevel(value, ",")[0] ?? "", " ");
  const duration = tokens.find((t) => /^\d*\.?\d+m?s$/.test(t));
  if (!duration) return null;
  const easing = tokens.find((t) => /^(ease|linear|ease-in|ease-out|ease-in-out|cubic-bezier\(.*\)|steps\(.*\))$/.test(t)) ?? "ease";
  return { duration, easing };
}

export function formatTransition(t: Transition): string {
  return `all ${t.duration} ${t.easing}`;
}
