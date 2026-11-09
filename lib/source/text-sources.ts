import * as t from "@babel/types";
import type { File } from "@babel/types";
import { parseSource } from "./parser";
import { walk } from "./walker";
import { cleanJsxText } from "./analysis";
import { escapeJsxText } from "./mutations";

/**
 * Text that reaches the page through code (a prop, a translation call, a component that splits it
 * into words) has no editable JSX text on the element itself. These helpers find the string in the
 * source that renders as the selected text, and rewrite it in place.
 */

export type TextLiteral = {
  file: string;
  /** `line:column` of the literal in the draft; identifies it for an edit. */
  loc: string;
  line: number;
  kind: "string" | "template" | "template-expr" | "jsx-text";
  /**
   * The text as written (template literals: cooked value; JSX text: whitespace-collapsed). Template
   * literals with expressions show each one as `{code}`, e.g. `{year} – Swipz` for `${year} – Swipz`.
   */
  value: string;
  /** For `template-expr`: the fixed text between the expressions. */
  quasis?: string[];
  /** Passed through a translation macro/call (Lingui `msg`/`t`/`<Trans>`, `i18n._`, i18next `t`). */
  translated: boolean;
};

export type TextSourceMatch = TextLiteral & {
  /** Which rendered text matched: 0 = the selected element, 1 = its parent, and so on. */
  depth: number;
};

/** Attributes whose strings are never visible copy. */
const NON_TEXT_ATTRIBUTES = /^(className|class|id|key|href|src|srcSet|type|rel|target|role|style|name|htmlFor|as|variant|size|weight|tone|color|align|lang|dir|method|action|encType|autoComplete|inputMode|sizes|loading|decoding|fetchPriority|referrerPolicy|crossOrigin|(aria|data)-.*)$/;
/** Tagged templates that hold code, not copy. */
const CODE_TAGS = new Set(["css", "styled", "keyframes", "createGlobalStyle", "injectGlobal", "gql", "graphql", "sql", "html", "svg", "tw"]);
const TRANSLATION_TAGS = new Set(["msg", "t", "defineMessage", "plural", "select"]);
const TRANSLATION_CALLS = /^(t|_|msg|defineMessage|i18n\._|i18n\.t|intl\.formatMessage)$/;

/** Letters and digits only, lowercased: ignores markup like `*accent*`, punctuation and spacing. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function collectTextLiterals(code: string, file: string): TextLiteral[] {
  let ast: File;
  try {
    ast = parseSource(code, file).ast;
  } catch {
    return [];
  }
  const out: TextLiteral[] = [];
  const push = (node: t.Node, kind: TextLiteral["kind"], value: string, ancestors: t.Node[]) => {
    if (!node.loc || !/\p{L}/u.test(value)) return;
    out.push({ file, loc: `${node.loc.start.line}:${node.loc.start.column}`, line: node.loc.start.line, kind, value, translated: isTranslated(ancestors) });
  };

  // Framekit's own walker follows Babel's visitor keys, so newer syntax never trips it up.
  walk(ast, (node, ancestors) => {
    if (t.isStringLiteral(node)) {
      if (isCopyPosition(node, ancestors)) push(node, "string", node.value, ancestors);
    } else if (t.isTemplateLiteral(node)) {
      const parent = ancestors[ancestors.length - 1];
      const tag = parent && t.isTaggedTemplateExpression(parent) ? calleeName(parent.tag) : null;
      if (!(tag && CODE_TAGS.has(tag.split(".")[0])) && isCopyPosition(node, ancestors)) {
        if (node.expressions.length === 0) push(node, "template", node.quasis[0]?.value.cooked ?? "", ancestors);
        else {
          // `${year} – Swipz`: the fixed parts are copy; the expressions stay as placeholders.
          const quasis = node.quasis.map((q) => q.value.cooked ?? "");
          if (/\p{L}/u.test(quasis.join(""))) {
            push(node, "template-expr", templateDisplay(node, code), ancestors);
            out[out.length - 1].quasis = quasis;
          }
        }
      }
    } else if (t.isJSXText(node)) {
      const value = cleanJsxText(node.value);
      if (value) push(node, "jsx-text", value, ancestors);
    }
  });
  return out;
}

/**
 * Find source strings that render as one of `texts` (innermost first). Returns the matches for the
 * innermost text that has any, so a heading assembled from words still finds its sentence, best
 * first: exact wording before case/punctuation-insensitive matches, then strings whose neighbours
 * in the file also appear around the element (the nav's "Team", not the footer's).
 */
export function findTextSources(literals: TextLiteral[], texts: string[]): TextSourceMatch[] {
  const byNorm = new Map<string, TextLiteral[]>();
  const byFile = new Map<string, TextLiteral[]>();
  const templates = literals.filter((l) => l.kind === "template-expr" && l.quasis);
  for (const literal of literals) {
    if (literal.kind === "template-expr") {
      (byFile.get(literal.file) ?? byFile.set(literal.file, []).get(literal.file)!).push(literal);
      continue;
    }
    const key = normalizeText(literal.value);
    if (!key || looksLikeCode(literal.value)) continue;
    (byNorm.get(key) ?? byNorm.set(key, []).get(key)!).push(literal);
    (byFile.get(literal.file) ?? byFile.set(literal.file, []).get(literal.file)!).push(literal);
  }
  for (let depth = 0; depth < texts.length; depth++) {
    const rendered = texts[depth] ?? "";
    const key = normalizeText(rendered);
    if (key.length < 2) continue;
    let matches = byNorm.get(key);
    if (!matches?.length) {
      // `{year} – Swipz` renders as "2026 – Swipz": match the fixed parts around the placeholders.
      const collapsed = rendered.replace(/\s+/g, " ").trim();
      matches = templates.filter((l) => templatePattern(l.quasis!).test(collapsed));
    }
    if (!matches.length) continue;

    // The nearest surrounding text that says more than the match itself, e.g. the whole nav.
    const context = texts.slice(depth + 1).map(normalizeText).find((t) => t.length > key.length && t.includes(key)) ?? "";
    const collapse = (v: string) => v.replace(/\s+/g, " ").trim();
    const scored = matches.map((m) => {
      const exact =
        m.kind === "template-expr" || collapse(m.value) === collapse(rendered) ? 2 : collapse(m.value).toLowerCase() === collapse(rendered).toLowerCase() ? 1 : 0;
      const neighbours = (byFile.get(m.file) ?? []).filter((n) => n !== m && Math.abs(n.line - m.line) <= 6);
      const shared = context ? neighbours.filter((n) => context.includes(normalizeText(n.value))).length : 0;
      const fit = neighbours.length ? shared / neighbours.length : 0;
      return { m, exact, fit };
    });
    scored.sort((a, b) => b.exact - a.exact || b.fit - a.fit);
    // With the exact wording found, case-only lookalikes ("team" as an id) are not the same text.
    const best = scored[0].exact;
    return scored.filter((s) => s.exact === best).slice(0, 5).map(({ m }) => ({ ...m, depth }));
  }
  return [];
}

/** URLs, anchors, paths and identifiers: never the visible copy, even when their letters match. */
function looksLikeCode(value: string): boolean {
  const v = value.trim();
  return /^[/#.]|^[a-z][a-z0-9+.-]*:|^[\w-]+\.(png|jpe?g|svg|webp|gif|avif|mp4|css|js|ts|tsx)$/i.test(v) || /^[a-z][a-z0-9]*([-_][a-z0-9]+)+$/.test(v);
}

/** Rewrite the literal at `loc` (as reported by collectTextLiterals). Throws when it changed meanwhile. */
export function setTextLiteral(ast: File, loc: string, expected: string, value: string, code = ""): void {
  let target: { node: t.Node; parent: t.Node | undefined } | null = null;
  walk(ast, (node, ancestors) => {
    if (target) return false;
    if ((t.isStringLiteral(node) || t.isTemplateLiteral(node) || t.isJSXText(node)) && node.loc && `${node.loc.start.line}:${node.loc.start.column}` === loc) {
      target = { node, parent: ancestors[ancestors.length - 1] };
      return false;
    }
  });
  const found = target as { node: t.Node; parent: t.Node | undefined } | null;
  if (!found) throw new TextSourceError();
  const { node, parent } = found;

  if (t.isStringLiteral(node)) {
    if (node.value !== expected) throw new TextSourceError();
    // JSX attribute strings have no escape sequences, but the printer escapes JS-style. Text that
    // would need escaping moves into an expression container, where escapes are valid.
    if (t.isJSXAttribute(parent) && /["'\\\n]/.test(value)) {
      parent.value = t.jsxExpressionContainer(t.stringLiteral(value));
      return;
    }
    node.value = value;
    // Drop the cached raw text so the printer re-quotes and escapes the new value.
    delete (node as { extra?: unknown }).extra;
    return;
  }
  if (t.isTemplateLiteral(node)) {
    const escape = (v: string) => v.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
    if (node.expressions.length === 0) {
      const quasi = node.quasis[0];
      if (!quasi || quasi.value.cooked !== expected) throw new TextSourceError();
      quasi.value = { raw: escape(value), cooked: value };
      return;
    }
    // With expressions: the text must keep every `{code}` placeholder, in order.
    if (templateDisplay(node, code) !== expected) throw new TextSourceError();
    const placeholders = node.expressions.map((e) => `{${sourceOf(e, code)}}`);
    const parts: string[] = [];
    let rest = value;
    for (const placeholder of placeholders) {
      const at = rest.indexOf(placeholder);
      if (at === -1) throw new TextSourceError(`Keep ${placeholder} in the text. It's filled in by code.`);
      parts.push(rest.slice(0, at));
      rest = rest.slice(at + placeholder.length);
    }
    parts.push(rest);
    node.quasis.forEach((q, i) => (q.value = { raw: escape(parts[i]), cooked: parts[i] }));
    return;
  }
  if (t.isJSXText(node)) {
    if (cleanJsxText(node.value) !== expected) throw new TextSourceError();
    // Keep same-line spacing next to sibling elements ("Hello <b>x</b>"); line breaks and
    // indentation are the printer's job, or it indents the text twice.
    const lead = /^[ \t]+/.test(node.value) && !/^\s*\n/.test(node.value) ? " " : "";
    const trail = /[ \t]+$/.test(node.value) && !/\n\s*$/.test(node.value) ? " " : "";
    node.value = lead + escapeJsxText(value) + trail;
    (node as t.JSXText & { extra?: { raw: string; rawValue: string } }).extra = { raw: node.value, rawValue: node.value };
    return;
  }
  throw new TextSourceError();
}

export class TextSourceError extends Error {
  constructor(message = "That text changed in the source since it was selected. Select the element again and retry.") {
    super(message);
  }
}

/** The source code of a node, for `{code}` placeholders. */
function sourceOf(node: t.Node, code: string): string {
  return node.start != null && node.end != null ? code.slice(node.start, node.end) : "…";
}

/** `${year} – Swipz` shown as `{year} – Swipz`. */
function templateDisplay(node: t.TemplateLiteral, code: string): string {
  let out = "";
  node.quasis.forEach((q, i) => {
    out += q.value.cooked ?? "";
    if (i < node.expressions.length) out += `{${sourceOf(node.expressions[i], code)}}`;
  });
  return out;
}

/** Rendered text of a template with expressions: its fixed parts with anything in between. */
function templatePattern(quasis: string[]): RegExp {
  const esc = (v: string) => v.replace(/\s+/g, " ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*");
  return new RegExp(`^${quasis.map(esc).join("(.+?)")}$`, "u");
}

/* ------------------------------------------------------------------ */

function calleeName(node: t.Node): string | null {
  if (t.isIdentifier(node)) return node.name;
  if (t.isMemberExpression(node) && !node.computed && t.isIdentifier(node.property)) {
    const object = calleeName(node.object);
    return object ? `${object}.${node.property.name}` : null;
  }
  if (t.isCallExpression(node)) return calleeName(node.callee); // e.g. styled.div`` / styled(Box)``
  return null;
}

/** Strings that could be visible copy: not imports, keys, type positions, or non-text attributes. */
function isCopyPosition(node: t.Node, ancestors: t.Node[]): boolean {
  const parent = ancestors[ancestors.length - 1];
  if (!parent) return false;
  if (t.isImportDeclaration(parent) || t.isExportAllDeclaration(parent) || t.isExportNamedDeclaration(parent) || t.isImportExpression(parent)) return false;
  if (t.isTSLiteralType(parent) || t.isTSEnumMember(parent) || t.isTSPropertySignature(parent) || t.isTSExternalModuleReference(parent)) return false;
  if ((t.isObjectProperty(parent) || t.isObjectMethod(parent) || t.isClassProperty(parent)) && parent.key === node) return false;
  if (t.isMemberExpression(parent) && parent.property === node) return false;
  if (t.isCallExpression(parent)) {
    const callee = calleeName(parent.callee);
    if (callee && /^(require|import|fetch|cn|clsx|cx|classNames|twMerge|cva|useTranslations|getTranslations)$/.test(callee)) return false;
  }
  if (t.isBinaryExpression(parent) || t.isSwitchCase(parent)) return false;
  // Inside a JSX attribute, directly or through an expression container.
  const attr = t.isJSXExpressionContainer(parent) ? ancestors[ancestors.length - 2] : parent;
  if (attr && t.isJSXAttribute(attr)) {
    const name = t.isJSXIdentifier(attr.name) ? attr.name.name : `${attr.name.namespace.name}:${attr.name.name.name}`;
    if (NON_TEXT_ATTRIBUTES.test(name)) return false;
  }
  return true;
}

function isTranslated(ancestors: t.Node[]): boolean {
  for (let i = ancestors.length - 1, hops = 0; i >= 0 && hops < 4; i--, hops++) {
    const node = ancestors[i];
    if (t.isTaggedTemplateExpression(node)) {
      const tag = calleeName(node.tag);
      if (tag && TRANSLATION_TAGS.has(tag)) return true;
    }
    if (t.isCallExpression(node)) {
      const callee = calleeName(node.callee);
      if (callee && TRANSLATION_CALLS.test(callee)) return true;
    }
    if (t.isJSXElement(node) && t.isJSXIdentifier(node.openingElement.name) && node.openingElement.name.name === "Trans") return true;
  }
  return false;
}
