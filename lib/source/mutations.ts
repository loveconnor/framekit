import * as t from "@babel/types";
import type { File, JSXElement } from "@babel/types";
import { parseSource, printSource, detectPrintOptions, assertParses } from "./parser";
import { analyzeFile, FK_STYLE_ATTR, isSoleLogicalBranch, textChildren, type SourceElement, type FileAnalysis } from "./analysis";
import type { AddableElement } from "@/types/elements";

export class MutationError extends Error {
  constructor(message: string, public readonly code: string = "UNSUPPORTED") {
    super(message);
  }
}

export type MutationSession = {
  ast: File;
  analysis: FileAnalysis;
  file: string;
  code: string;
};

export function openForMutation(code: string, file: string): MutationSession {
  const { ast } = parseSource(code, file);
  return { ast, analysis: analyzeFile(ast, file), file, code };
}

export function requireElement(session: MutationSession, id: string): SourceElement {
  const el = session.analysis.byId.get(id);
  if (!el) throw new MutationError("Framekit couldn't identify the source for this element. Reload the project and try again.", "NOT_FOUND");
  return el;
}

/** Print the mutated AST and make sure it still parses before anyone uses it. */
export function finish(session: MutationSession): string {
  const options = detectPrintOptions(session.code);
  const code = printSource(session.ast, options);
  assertParses(code, session.file);
  return code;
}

/* ------------------------------ text ------------------------------ */

export function setText(el: SourceElement, value: string): void {
  const { blocker } = textChildren(el.node);
  if (blocker) throw new MutationError("This content comes from JavaScript and can't be edited visually.");
  const node = el.node;
  if (node.openingElement.selfClosing) {
    node.openingElement.selfClosing = false;
    node.closingElement = t.jsxClosingElement(cloneName(node.openingElement.name));
  }
  node.children = value === "" ? [] : [jsxTextNode(value)];
}

function jsxTextNode(value: string): t.JSXText {
  const escaped = escapeJsxText(value);
  const node = t.jsxText(escaped);
  (node as t.JSXText & { extra?: { raw: string; rawValue: string } }).extra = { raw: escaped, rawValue: escaped };
  return node;
}

export function escapeJsxText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;")
    .replace(/ /g, "&nbsp;");
}

function cloneName(name: JSXElement["openingElement"]["name"]): JSXElement["openingElement"]["name"] {
  return t.cloneNode(name, true);
}

/* --------------------------- attributes --------------------------- */

const EDITABLE_ATTRIBUTES = new Set(["href", "target", "rel", "src", "alt", "title", "type", "width", "height", "id", "aria-label", "placeholder", "loading"]);

export function setAttribute(el: SourceElement, name: string, value: string | boolean | null): void {
  if (!EDITABLE_ATTRIBUTES.has(name)) throw new MutationError(`The ${name} attribute can't be edited visually.`);
  const attrs = el.node.openingElement.attributes;
  const index = attrs.findIndex((a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name, { name }));
  const current = index >= 0 ? (attrs[index] as t.JSXAttribute) : null;
  if (current && !isStaticAttributeValue(current)) {
    throw new MutationError(`The ${name} value is computed by JavaScript and can't be edited visually.`);
  }
  if (value === null || value === false) {
    if (index >= 0) attrs.splice(index, 1);
    return;
  }
  let attrValue: t.JSXAttribute["value"];
  if (value === true) attrValue = null;
  else if ((name === "width" || name === "height") && /^\d+$/.test(value) && el.source === "next-image") {
    attrValue = t.jsxExpressionContainer(t.numericLiteral(Number(value)));
  } else attrValue = t.stringLiteral(value);
  const attr = t.jsxAttribute(t.jsxIdentifier(name), attrValue);
  if (index >= 0) attrs[index] = attr;
  else attrs.push(attr);
}

function isStaticAttributeValue(attr: t.JSXAttribute): boolean {
  const v = attr.value;
  if (v === null || v === undefined || t.isStringLiteral(v)) return true;
  if (t.isJSXExpressionContainer(v)) {
    const e = v.expression;
    return t.isStringLiteral(e) || t.isNumericLiteral(e) || t.isBooleanLiteral(e) || (t.isTemplateLiteral(e) && e.expressions.length === 0);
  }
  return false;
}

export function ensureStyleId(el: SourceElement, makeId: () => string): string {
  const attrs = el.node.openingElement.attributes;
  const existing = attrs.find((a): a is t.JSXAttribute => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name, { name: FK_STYLE_ATTR }));
  if (existing && t.isStringLiteral(existing.value)) return existing.value.value;
  const id = makeId();
  attrs.push(t.jsxAttribute(t.jsxIdentifier(FK_STYLE_ATTR), t.stringLiteral(id)));
  return id;
}

/** Remove or update a property in a static `style={{ ... }}` object so a stylesheet rule can win. */
export function setInlineStyleProperty(el: SourceElement, cssProperty: string, value: string | null): boolean {
  const attr = el.node.openingElement.attributes.find(
    (a): a is t.JSXAttribute => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name, { name: "style" }),
  );
  if (!attr || !t.isJSXExpressionContainer(attr.value) || !t.isObjectExpression(attr.value.expression)) return false;
  const obj = attr.value.expression;
  const camel = cssProperty.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  const index = obj.properties.findIndex(
    (p) => t.isObjectProperty(p) && !p.computed && ((t.isIdentifier(p.key) && p.key.name === camel) || (t.isStringLiteral(p.key) && p.key.value === camel)),
  );
  if (index < 0) return false;
  if (value === null) obj.properties.splice(index, 1);
  else (obj.properties[index] as t.ObjectProperty).value = t.stringLiteral(value);
  if (obj.properties.length === 0) {
    const attrs = el.node.openingElement.attributes;
    attrs.splice(attrs.indexOf(attr), 1);
  }
  return true;
}

/* ------------------------------ tag ------------------------------- */

export function setTag(el: SourceElement, tag: string): void {
  if (!/^h[1-6]$/.test(el.tag) || !/^h[1-6]$/.test(tag)) throw new MutationError("Only headings can change their level.");
  el.node.openingElement.name = t.jsxIdentifier(tag);
  if (el.node.closingElement) el.node.closingElement.name = t.jsxIdentifier(tag);
}

/* --------------------------- structure ---------------------------- */

function parentChildren(el: SourceElement): { parent: t.JSXElement | t.JSXFragment; index: number } {
  const parentNode = el.ancestors[el.ancestors.length - 1];
  if (!t.isJSXElement(parentNode) && !t.isJSXFragment(parentNode)) {
    throw new MutationError("This element's position is controlled by React code.");
  }
  const index = parentNode.children.indexOf(el.node);
  if (index < 0) throw new MutationError("Framekit couldn't locate this element in its parent.", "NOT_FOUND");
  return { parent: parentNode, index };
}

export function deleteElement(el: SourceElement): void {
  if (isSoleLogicalBranch(el)) {
    const container = el.ancestors[el.ancestors.length - 2] as t.JSXExpressionContainer;
    const holder = el.ancestors[el.ancestors.length - 3] as t.JSXElement | t.JSXFragment;
    removeChildWithWhitespace(holder, holder.children.indexOf(container));
    return;
  }
  const { parent, index } = parentChildren(el);
  removeChildWithWhitespace(parent, index);
}

/** Remove a child and the indentation text node that preceded it so the printed JSX stays tidy. */
function removeChildWithWhitespace(parent: t.JSXElement | t.JSXFragment, index: number): void {
  if (index < 0) return;
  const prev = parent.children[index - 1];
  if (prev && t.isJSXText(prev) && /^\s*$/.test(prev.value) && /\n/.test(prev.value)) {
    parent.children.splice(index - 1, 2);
  } else {
    parent.children.splice(index, 1);
  }
}

export function duplicateElement(el: SourceElement, makeStyleId: () => string): t.JSXElement {
  const { parent, index } = parentChildren(el);
  const copy = t.cloneNode(el.node, true, true) as t.JSXElement;
  stripLocations(copy);
  refreshIdentifiers(copy, makeStyleId);
  insertChild(parent, index + 1, copy);
  return copy;
}

/** Give copied elements fresh style ids and drop HTML ids so the page never has duplicates. */
function refreshIdentifiers(node: t.Node, makeStyleId: () => string): void {
  t.traverseFast(node, (n) => {
    if (!t.isJSXElement(n)) return;
    const attrs = n.openingElement.attributes;
    for (let i = attrs.length - 1; i >= 0; i--) {
      const a = attrs[i];
      if (!t.isJSXAttribute(a) || !t.isJSXIdentifier(a.name)) continue;
      if (a.name.name === FK_STYLE_ATTR) {
        const sourceId = t.isStringLiteral(a.value) ? a.value.value : null;
        const next = makeStyleId();
        (a as t.JSXAttribute & { fkCopiedFrom?: string }).fkCopiedFrom = sourceId ?? undefined;
        a.value = t.stringLiteral(next);
      } else if (a.name.name === "id" || a.name.name === "data-fk-id") {
        attrs.splice(i, 1);
      }
    }
  });
}

/** Collect (from, to) style id pairs created during a duplicate so rules can be copied. */
export function collectCopiedStyleIds(node: t.Node): Array<{ from: string; to: string }> {
  const pairs: Array<{ from: string; to: string }> = [];
  t.traverseFast(node, (n) => {
    if (!t.isJSXElement(n)) return;
    for (const a of n.openingElement.attributes) {
      if (t.isJSXAttribute(a) && t.isJSXIdentifier(a.name, { name: FK_STYLE_ATTR }) && t.isStringLiteral(a.value)) {
        const from = (a as t.JSXAttribute & { fkCopiedFrom?: string }).fkCopiedFrom;
        if (from) pairs.push({ from, to: a.value.value });
      }
    }
  });
  return pairs;
}

function stripLocations(node: t.Node): void {
  t.traverseFast(node, (n) => {
    const any = n as t.Node & { loc?: unknown; start?: unknown; end?: unknown; original?: unknown; extra?: Record<string, unknown> };
    delete any.loc;
    delete any.start;
    delete any.end;
    delete any.original;
    if (any.extra && "parenthesized" in any.extra) delete any.extra.parenthesized;
  });
}

/** Insert `child` as the nth element child (counting JSX elements and expression children, not whitespace). */
function insertChild(parent: t.JSXElement | t.JSXFragment, rawIndex: number, child: t.JSXElement): void {
  const children = parent.children;
  const index = Math.max(0, Math.min(rawIndex, children.length));
  const indentation = inferChildIndentation(parent);
  children.splice(index, 0, t.jsxText(`\n${indentation}`), child);
  normalizeTrailingWhitespace(parent);
}

function inferChildIndentation(parent: t.JSXElement | t.JSXFragment): string {
  for (const child of parent.children) {
    if (t.isJSXText(child)) {
      const m = child.value.match(/\n([ \t]+)\S?$/);
      if (m && child.value.trim() === "") return m[1];
    }
  }
  const openLine = parent.loc?.start.column ?? 0;
  return " ".repeat(openLine + 2);
}

/** Make sure the element's closing tag sits on its own line after structural edits. */
function normalizeTrailingWhitespace(parent: t.JSXElement | t.JSXFragment): void {
  const children = parent.children;
  const last = children[children.length - 1];
  if (last && t.isJSXText(last) && /^\s*$/.test(last.value)) return;
  const parentIndent = " ".repeat(parent.loc?.start.column ?? 0);
  children.push(t.jsxText(`\n${parentIndent}`));
}

export function moveElement(el: SourceElement, targetParent: SourceElement, elementIndex: number): void {
  const { parent, index } = parentChildren(el);
  if (!t.isJSXElement(targetParent.node)) throw new MutationError("Elements can only be moved inside another element.");
  const target = targetParent.node;
  if (parent !== target) {
    // Cross-parent moves are limited to parents in the same file with plain JSX children.
    if (targetParent.node.openingElement.selfClosing) {
      target.openingElement.selfClosing = false;
      target.closingElement = t.jsxClosingElement(cloneName(target.openingElement.name));
    }
  }
  const node = el.node;
  removeChildWithWhitespace(parent, index);
  const slot = elementSlotIndex(target, elementIndex);
  insertChild(target, slot, node);
}

/** Convert an index among element children into an index in the raw children array. */
export function elementSlotIndex(parent: t.JSXElement | t.JSXFragment, elementIndex: number): number {
  let seen = 0;
  for (let i = 0; i < parent.children.length; i++) {
    const c = parent.children[i];
    if (t.isJSXElement(c) || t.isJSXExpressionContainer(c) || t.isJSXFragment(c)) {
      if (seen === elementIndex) return i;
      seen++;
    }
  }
  // Append: before the trailing whitespace text if present.
  const last = parent.children[parent.children.length - 1];
  if (last && t.isJSXText(last) && /^\s*$/.test(last.value)) return parent.children.length - 1;
  return parent.children.length;
}

export function insertNewElement(
  target: SourceElement,
  placement: "inside" | "after",
  element: AddableElement,
  makeStyleId: () => string,
): t.JSXElement {
  const node = buildElement(element, makeStyleId);
  if (placement === "inside") {
    if (!t.isJSXElement(target.node)) throw new MutationError("Elements can only be added inside another element.");
    const parent = target.node;
    if (parent.openingElement.selfClosing) {
      parent.openingElement.selfClosing = false;
      parent.closingElement = t.jsxClosingElement(cloneName(parent.openingElement.name));
    }
    const last = parent.children[parent.children.length - 1];
    const slot = last && t.isJSXText(last) && /^\s*$/.test(last.value) ? parent.children.length - 1 : parent.children.length;
    insertChild(parent, slot, node);
  } else {
    const { parent, index } = parentChildren(target);
    insertChild(parent, index + 1, node);
  }
  return node;
}

export const NEW_ELEMENT_STYLES: Partial<Record<AddableElement, Record<string, string>>> = {
  section: { padding: "48px 24px" },
  container: { padding: "24px" },
  grid: { display: "grid", "grid-template-columns": "repeat(2, minmax(0, 1fr))", gap: "24px" },
  flex: { display: "flex", "align-items": "center", gap: "16px" },
  header: { padding: "16px 24px" },
  footer: { padding: "32px 24px" },
  nav: { display: "flex", "align-items": "center", gap: "24px" },
  spacer: { height: "48px" },
  form: { display: "flex", "flex-direction": "column", gap: "8px", "max-width": "400px" },
};

function buildElement(kind: AddableElement, makeStyleId: () => string): t.JSXElement {
  const attr = (name: string, value: string | null = null) => t.jsxAttribute(t.jsxIdentifier(name), value === null ? null : t.stringLiteral(value));
  const withStyle = (attrs: t.JSXAttribute[]) => [...attrs, attr(FK_STYLE_ATTR, makeStyleId())];
  const make = (tag: string, attrs: t.JSXAttribute[], children: t.JSXElement["children"], selfClosing = false) =>
    t.jsxElement(
      t.jsxOpeningElement(t.jsxIdentifier(tag), attrs, selfClosing),
      selfClosing ? null : t.jsxClosingElement(t.jsxIdentifier(tag)),
      children,
    );
  const text = (tag: string, attrs: t.JSXAttribute[], value: string) => make(tag, attrs, [jsxTextNode(value)]);
  const block = (tag: string, children: t.JSXElement[]) => {
    const parts: t.JSXElement["children"] = [];
    for (const child of children) parts.push(jsxTextNode("\n"), child);
    parts.push(jsxTextNode("\n"));
    return make(tag, withStyle([]), parts);
  };
  switch (kind) {
    case "section":
      return make("section", withStyle([]), []);
    case "container":
    case "grid":
    case "flex":
    case "spacer":
      return make("div", withStyle([]), []);
    case "header":
      return make("header", withStyle([]), []);
    case "footer":
      return make("footer", withStyle([]), []);
    case "nav":
      return make("nav", withStyle([attr("aria-label", "Navigation")]), []);
    case "heading":
      return text("h2", [], "Heading");
    case "paragraph":
      return text("p", [], "Write something here.");
    case "text":
      return text("span", [], "Text");
    case "quote":
      return text("blockquote", [], "A quote worth repeating.");
    case "list":
      return block("ul", [text("li", [], "First item"), text("li", [], "Second item"), text("li", [], "Third item")]);
    case "list-item":
      return text("li", [], "List item");
    case "button":
      return text("button", [attr("type", "button")], "Button");
    case "link":
      return text("a", [attr("href", "#")], "Link");
    case "divider":
      return make("hr", [], [], true);
    case "image":
      return make("img", [attr("src", "/framekit/placeholder.svg"), attr("alt", ""), attr("width", "640"), attr("height", "400")], [], true);
    case "video":
      return make("video", [attr("controls"), attr("width", "640"), attr("height", "360")], [], true);
    case "form":
      return block("form", [
        text("label", [attr("htmlFor", "email")], "Email"),
        make("input", [attr("id", "email"), attr("name", "email"), attr("type", "email"), attr("placeholder", "you@example.com")], [], true),
        text("button", [attr("type", "submit")], "Submit"),
      ]);
    case "label":
      return text("label", [], "Label");
    case "input":
      return make("input", [attr("type", "text"), attr("placeholder", "Type here")], [], true);
    case "textarea":
      return make("textarea", [attr("placeholder", "Type here"), attr("rows", "4")], [], true);
  }
}
