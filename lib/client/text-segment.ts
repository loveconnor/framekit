/**
 * The selected element often shows only part of a source string: one word of a heading, the accent
 * span of "Flip through it like a *Photo Gallery*". These helpers find that part inside the string
 * so the inspector can edit just it and splice the result back, keeping markup like `*…*` around it.
 */

export type RenderedLevel = {
  /** The element's (or ancestor's) text as rendered, whitespace collapsed. */
  raw: string;
  /** The same with aria-hidden parts left out (animated components duplicate text for screen readers). */
  accessible: string;
  /** How many times the selected element's text occurs in `raw` before the element itself. */
  occurrence: number | null;
};

export type Segment = { start: number; end: number };

/**
 * Pattern for `text` as a whole run of words (not inside a longer word), with any whitespace
 * between them. Shared with the preview bridge, which counts occurrences the same way.
 */
export function segmentPattern(text: string): RegExp | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const body = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const lead = /^[\p{L}\p{N}]/u.test(words[0]) ? "(?<![\\p{L}\\p{N}])" : "";
  const trail = /[\p{L}\p{N}]$/u.test(words[words.length - 1]) ? "(?![\\p{L}\\p{N}])" : "";
  return new RegExp(lead + body + trail, "gu");
}

export function countOccurrences(haystack: string, text: string): number {
  const re = segmentPattern(text);
  return re ? [...haystack.matchAll(re)].length : 0;
}

/**
 * Where `own` (the selected element's text) sits inside `literal` (the source string), or null to
 * edit the whole string: when `own` is the whole thing, or its position is ambiguous.
 * `context` is the rendered text that matched the literal; `occurrence` says which repeat of `own`
 * in the rendered text was selected.
 */
export function locateSegment(literal: string, own: string, context: string, occurrence: number | null): Segment | null {
  const re = segmentPattern(own);
  if (!re) return null;
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  if (norm(own) === norm(context)) return null; // the element shows the whole string
  const hits = [...literal.matchAll(re)];
  if (hits.length === 0) return null;
  let hit = hits.length === 1 ? hits[0] : null;
  if (!hit && occurrence !== null) {
    // The raw text may repeat the sentence (screen-reader copy + animated pieces); fold it back.
    const inContext = countOccurrences(context, own);
    const index = inContext > 0 ? occurrence % inContext : occurrence;
    if (inContext === hits.length) hit = hits[index] ?? null;
  }
  if (!hit || hit.index === undefined) return null;
  return { start: hit.index, end: hit.index + hit[0].length };
}

export type TextOrigin = { level: number; variant: "raw" | "accessible" | "piece" };

/**
 * Flatten into the lookup list the server takes (at most 12 entries), remembering where each came
 * from: the element's text, then its separate text pieces (`{name}, {role}`), then its ancestors'.
 */
export function flattenLevels(levels: RenderedLevel[], pieces: string[] = []): { texts: string[]; origin: TextOrigin[] } {
  const texts: string[] = [];
  const origin: TextOrigin[] = [];
  const add = (text: string, from: TextOrigin) => {
    if (!text || texts.length >= 12 || texts.includes(text)) return;
    texts.push(text);
    origin.push(from);
  };
  levels.forEach((l, level) => {
    add(l.raw, { level, variant: "raw" });
    add(l.accessible, { level, variant: "accessible" });
    if (level === 0) for (const piece of pieces) add(piece, { level: 0, variant: "piece" });
  });
  return { texts, origin };
}
