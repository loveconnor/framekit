import * as t from "@babel/types";
import type { File, JSXElement, Node } from "@babel/types";
import * as recast from "recast";
import { walk } from "./walker";
import { shortHash } from "@/lib/filesystem/paths";
import { CONTAINER_TAGS, TEXT_TAGS, VOID_TAGS } from "./labels";
import type { AttrValue, ElementInfo, ElementOps, ElementSource, ElementText, OpState } from "@/types/elements";

export const FK_ID_ATTR = "data-fk-id";
export const FK_STYLE_ATTR = "data-fk-style";

/** One JSX element in a file, with enough structure to compute identity and safety. */
export type SourceElement = {
  node: JSXElement;
  /** Chain from file root to the element's parent node, nearest last. */
  ancestors: Node[];
  parent: SourceElement | null;
  children: SourceElement[];
  /** Structural path from a root element, e.g. [0, 2, 1]. */
  path: number[];
  id: string;
  source: ElementSource | "component" | "fragment-like";
  tag: string;
  componentName: string | null;
  /** The element is a descendant of an <svg>; it is left uninstrumented. */
  insideSvg: boolean;
  /**
   * The JSX name isn't the tag, though the element renders one: a variable holding a tag name
   * (`<Tag>` with `{ as: Tag = "p" }`), a styled element (`const Title = styled.h3`…``) or a motion
   * element (`<motion.div>`). It's treated as that HTML element, but its JSX name is never rewritten.
   */
  tagFrom?: "variable" | "styled" | "motion";
};

export type FileAnalysis = {
  file: string;
  fileKey: string;
  elements: SourceElement[];
  byId: Map<string, SourceElement>;
  /** Local import bindings: local name -> module source. */
  imports: Map<string, string>;
  /** Styled elements this file exports (export name -> tag), and names it re-exports from elsewhere. */
  exportedTags: Map<string, string>;
  reexports: Map<string, { source: string; imported: string }>;
  /** Sources of `export * from "…"`. */
  reexportAll: string[];
  rootCount: number;
};

export function fileKeyFor(file: string): string {
  return shortHash(file, 6);
}

export function makeElementId(fileKey: string, path: number[]): string {
  return `${fileKey}:${path.join(".")}`;
}

export type AnalyzeOptions = {
  /**
   * The HTML tag an imported name renders, when it's a styled element defined in another project
   * file (`import { HeadingPair } from "@/ui"`). Without it, imported names stay components.
   */
  resolveImportedTag?: (source: string, importedName: string) => string | null;
};

/** Collect every JSX element in the file and give each a stable structural id. */
export function analyzeFile(ast: File, file: string, options: AnalyzeOptions = {}): FileAnalysis {
  const fileKey = fileKeyFor(file);
  const imports = new Map<string, string>();
  const importedNames = new Map<string, { source: string; imported: string }>();
  for (const stmt of ast.program.body) {
    if (t.isImportDeclaration(stmt)) {
      for (const spec of stmt.specifiers) {
        imports.set(spec.local.name, stmt.source.value);
        const imported = t.isImportSpecifier(spec) ? (t.isIdentifier(spec.imported) ? spec.imported.name : spec.imported.value) : "default";
        importedNames.set(spec.local.name, { source: stmt.source.value, imported });
      }
    }
  }
  const resolveImported = (name: string): string | null => {
    const imp = importedNames.get(name);
    return imp && options.resolveImportedTag ? options.resolveImportedTag(imp.source, imp.imported) : null;
  };
  const { localTags, exportedTags, reexports, reexportAll } = collectStyledDeclarations(ast, imports, resolveImported);
  const resolveName = (name: string): string | null => localTags.get(name) ?? resolveImported(name);

  const elements: SourceElement[] = [];
  const byNode = new Map<Node, SourceElement>();
  let rootCount = 0;

  walk(ast, (node, ancestors) => {
    if (!t.isJSXElement(node)) return;
    let parent: SourceElement | null = null;
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const candidate = byNode.get(ancestors[i]);
      if (candidate) {
        parent = candidate;
        break;
      }
    }
    const nameNode = node.openingElement.name;
    let { tag, componentName, source } = classifyName(nameNode, imports);
    let tagFrom: SourceElement["tagFrom"];
    if (source === "component" && t.isJSXIdentifier(nameNode)) {
      const variableTag = resolveTagVariable(nameNode.name, ancestors);
      const styledTag = variableTag ? null : resolveName(nameNode.name);
      if (variableTag || styledTag) {
        tagFrom = variableTag ? "variable" : "styled";
        ({ tag, componentName, source } = { tag: (variableTag ?? styledTag)!, componentName: nameNode.name, source: "native" });
      }
    } else if (source === "component" && t.isJSXMemberExpression(nameNode) && t.isJSXIdentifier(nameNode.object)) {
      // <motion.div>: motion components render the named HTML element and pass data attributes on.
      const from = imports.get(nameNode.object.name) ?? "";
      if (/^(motion|framer-motion|motion\/react|motion\/react-client|motion\/react-m)$/.test(from) && HOST_TAG.test(nameNode.property.name)) {
        tagFrom = "motion";
        ({ tag, componentName, source } = { tag: nameNode.property.name, componentName: `${nameNode.object.name}.${nameNode.property.name}`, source: "native" });
      }
    }
    const element: SourceElement = {
      node,
      ancestors: [...ancestors],
      parent,
      children: [],
      path: [],
      id: "",
      source,
      tag,
      componentName,
      insideSvg: parent ? parent.insideSvg || parent.tag === "svg" : false,
      tagFrom,
    };
    if (parent) {
      element.path = [...parent.path, parent.children.length];
      parent.children.push(element);
    } else {
      element.path = [rootCount++];
    }
    element.id = makeElementId(fileKey, element.path);
    byNode.set(node, element);
    elements.push(element);
  });

  const byId = new Map(elements.map((e) => [e.id, e]));
  return { file, fileKey, elements, byId, imports, rootCount, exportedTags, reexports, reexportAll };
}

const STYLED_SOURCES = /(^|\/)(@linaria\/react|styled-components|@emotion\/styled|@stitches\/react|goober|@pigment-css\/react)$/;

/**
 * Top-level `const Title = styled.h3`…`` style declarations: which local names render which HTML
 * tag, and which of them the file exports (directly, renamed, or re-exported from elsewhere).
 */
function collectStyledDeclarations(ast: File, imports: Map<string, string>, resolveImported: (name: string) => string | null) {
  const localTags = new Map<string, string>();
  const exportedTags = new Map<string, string>();
  const reexports = new Map<string, { source: string; imported: string }>();
  const reexportAll: string[] = [];
  const isStyled = (name: string) => STYLED_SOURCES.test(imports.get(name) ?? "");

  /** `styled.h3`, `styled("p")`, `styled(Title)`, with `.attrs(…)`, generics or object styles. */
  const tagOf = (expr: Node | null | undefined): string | null => {
    if (!expr) return null;
    if (t.isTaggedTemplateExpression(expr)) return tagOf(expr.tag);
    if (t.isTSInstantiationExpression(expr) || t.isTSAsExpression(expr) || t.isTSSatisfiesExpression(expr)) return tagOf(expr.expression);
    if (t.isMemberExpression(expr) && !expr.computed && t.isIdentifier(expr.property)) {
      if (t.isIdentifier(expr.object) && isStyled(expr.object.name)) return HOST_TAG.test(expr.property.name) ? expr.property.name : null;
      if (expr.property.name === "attrs" || expr.property.name === "withConfig") return tagOf(expr.object);
      return null;
    }
    if (t.isCallExpression(expr)) {
      const callee = expr.callee;
      if (t.isIdentifier(callee) && isStyled(callee.name)) {
        const arg = expr.arguments[0];
        if (t.isStringLiteral(arg)) return HOST_TAG.test(arg.value) ? arg.value : null;
        if (t.isIdentifier(arg)) return localTags.get(arg.name) ?? resolveImported(arg.name);
        return null;
      }
      return tagOf(callee); // styled.div({...}), styled.h3.attrs({...})`…`
    }
    return null;
  };

  const declare = (decl: Node, exported: boolean) => {
    if (!t.isVariableDeclarator(decl) || !t.isIdentifier(decl.id)) return;
    const tag = tagOf(decl.init);
    if (!tag) return;
    localTags.set(decl.id.name, tag);
    if (exported) exportedTags.set(decl.id.name, tag);
  };

  for (const stmt of ast.program.body) {
    if (t.isVariableDeclaration(stmt)) stmt.declarations.forEach((d) => declare(d, false));
    else if (t.isExportNamedDeclaration(stmt)) {
      if (t.isVariableDeclaration(stmt.declaration)) stmt.declaration.declarations.forEach((d) => declare(d, true));
    } else if (t.isExportAllDeclaration(stmt)) reexportAll.push(stmt.source.value);
  }
  // Export lists and re-exports, after all locals are known.
  for (const stmt of ast.program.body) {
    if (!t.isExportNamedDeclaration(stmt) || stmt.declaration) continue;
    for (const spec of stmt.specifiers) {
      if (!t.isExportSpecifier(spec)) continue;
      const nameOf = (n: t.Identifier | t.StringLiteral) => (t.isIdentifier(n) ? n.name : n.value);
      const exportedName = nameOf(spec.exported);
      const localName = nameOf(spec.local);
      if (stmt.source) reexports.set(exportedName, { source: stmt.source.value, imported: localName });
      else {
        const tag = localTags.get(localName);
        if (tag) exportedTags.set(exportedName, tag);
        else if (imports.has(localName)) {
          // `import { A } from "./a"; export { A };`
          reexports.set(exportedName, { source: imports.get(localName)!, imported: localName });
        }
      }
    }
  }
  for (const stmt of ast.program.body) {
    if (t.isExportDefaultDeclaration(stmt) && t.isIdentifier(stmt.declaration) && localTags.has(stmt.declaration.name)) {
      exportedTags.set("default", localTags.get(stmt.declaration.name)!);
    }
  }
  return { localTags, exportedTags, reexports, reexportAll };
}

const HOST_TAG = /^[a-z][a-z0-9]*$/;

/**
 * `<Tag>` where Tag holds a tag name: a destructured prop with a string default
 * (`{ as: Tag = "p" }`) or a local constant made only of tag strings and props
 * (`const Tag = level === 1 ? "h1" : "h2"`, `const Tag = as ?? "div"`). Returns the default tag.
 */
function resolveTagVariable(name: string, ancestors: Node[]): string | null {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const scope = ancestors[i];
    if (!t.isFunction(scope)) continue;
    for (const param of scope.params) {
      const found = fromPattern(param, name);
      if (found !== undefined) return found;
    }
    if (t.isBlockStatement(scope.body)) {
      for (const stmt of scope.body.body) {
        if (!t.isVariableDeclaration(stmt)) continue;
        for (const decl of stmt.declarations) {
          if (t.isIdentifier(decl.id, { name }) && decl.init) return tagFromExpression(decl.init);
          const found = fromPattern(decl.id, name);
          if (found !== undefined) return found;
        }
      }
    }
    return null; // the nearest function owns the binding; don't look further out
  }
  return null;
}

/** `undefined`: not bound here. `null`: bound, but not to a tag string. */
function fromPattern(pattern: Node, name: string): string | null | undefined {
  if (t.isObjectPattern(pattern)) {
    for (const prop of pattern.properties) {
      if (!t.isObjectProperty(prop)) continue;
      const value = prop.value;
      if (t.isAssignmentPattern(value) && t.isIdentifier(value.left, { name })) return tagFromExpression(value.right);
      if (t.isIdentifier(value, { name })) return null;
    }
  }
  if (t.isAssignmentPattern(pattern)) return fromPattern(pattern.left, name);
  return undefined;
}

function tagFromExpression(expr: Node): string | null {
  if (t.isStringLiteral(expr)) return HOST_TAG.test(expr.value) ? expr.value : null;
  if (t.isTSAsExpression(expr) || t.isTSSatisfiesExpression(expr)) return tagFromExpression(expr.expression);
  if (t.isConditionalExpression(expr)) {
    // Both branches must be tags: `isLink ? Link : "a"` can render a component.
    const a = tagFromExpression(expr.consequent);
    const b = tagFromExpression(expr.alternate);
    return a && b ? a : null;
  }
  if (t.isLogicalExpression(expr)) {
    // `as ?? "div"`: the string is the fallback; the other side must be a plain prop/variable.
    if (!(t.isIdentifier(expr.left) || t.isMemberExpression(expr.left) || t.isStringLiteral(expr.left))) return null;
    return tagFromExpression(expr.right) ?? (t.isStringLiteral(expr.left) ? tagFromExpression(expr.left) : null);
  }
  if (t.isTemplateLiteral(expr) && expr.expressions.length === 0) return tagFromExpression(t.stringLiteral(expr.quasis[0]?.value.cooked ?? ""));
  return null;
}

function classifyName(
  name: JSXElement["openingElement"]["name"],
  imports: Map<string, string>,
): { tag: string; componentName: string | null; source: SourceElement["source"] } {
  if (t.isJSXIdentifier(name)) {
    const n = name.name;
    if (/^[a-z]/.test(n)) return { tag: n, componentName: null, source: "native" };
    if (n === "Fragment") return { tag: "fragment", componentName: n, source: "fragment-like" };
    const from = imports.get(n);
    if (from === "next/image") return { tag: "img", componentName: n, source: "next-image" };
    if (from === "next/link") return { tag: "a", componentName: n, source: "next-link" };
    return { tag: n, componentName: n, source: "component" };
  }
  if (t.isJSXMemberExpression(name)) {
    const printed = recast.print(name).code;
    if (printed === "React.Fragment") return { tag: "fragment", componentName: printed, source: "fragment-like" };
    return { tag: printed, componentName: printed, source: "component" };
  }
  return { tag: recast.print(name).code, componentName: null, source: "component" };
}

export function isInstrumentable(el: SourceElement): boolean {
  if (el.insideSvg) return false;
  if (el.source === "component" || el.source === "fragment-like") return false;
  if (el.tag === "html" || el.tag === "head" || el.tag === "script" || el.tag === "style" || el.tag === "title" || el.tag === "meta" || el.tag === "link") return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Element information for the editor                                  */
/* ------------------------------------------------------------------ */

export type AnalysisContext = {
  /** True when the file is imported by more than one module or is a layout. */
  shared: boolean;
};

export function describeElement(el: SourceElement, analysis: FileAnalysis, ctx: AnalysisContext): ElementInfo {
  const attributes = readAttributes(el.node);
  const hasSpread = el.node.openingElement.attributes.some((a) => t.isJSXSpreadAttribute(a));
  const styleAttr = attributes[FK_STYLE_ATTR];
  const styleId = styleAttr?.kind === "static" ? styleAttr.value : null;
  delete attributes[FK_STYLE_ATTR];
  delete attributes[FK_ID_ATTR];

  const repeated = isRepeated(el) || (el.parent ? isRepeatedDeep(el.parent) : false);
  const conditional = isConditional(el);
  const isRoot = el.parent === null;
  const containsChildrenSlot = containsChildrenExpression(el.node);
  const isBody = el.tag === "body";
  const directChild = isDirectJsxChild(el);

  const text = describeText(el);
  const inlineStyle = describeInlineStyle(el.node);

  const ok: OpState = { allowed: true };
  const no = (reason: string): OpState => ({ allowed: false, reason });

  const structuralBlock = isBody
    ? no("The page body can't be removed.")
    : isRoot
      ? no("This is the root element of a component.")
      : containsChildrenSlot
        ? no("This element renders the page's children and can't be changed structurally.")
        : repeated
          ? no("This element is rendered from a list in React code. Changes apply to every item.")
          : null;

  const ops: ElementOps = {
    setText: text.kind === "editable" ? ok : no(text.kind === "readonly" ? text.reason : "This element has no text."),
    setStyle: ok,
    setAttribute: ok,
    setTag: el.tagFrom
      ? no(
          el.tagFrom === "styled"
            ? `This element's tag is set where ${el.componentName ?? "it"} is styled.`
            : el.tagFrom === "motion"
              ? "This element's tag is part of its motion component."
              : "This element's tag comes from a prop. Change it where the component is used.",
        )
      : /^h[1-6]$/.test(el.tag)
        ? ok
        : no("Only headings can change their level."),
    delete: structuralBlock ?? (directChild || isSoleLogicalBranch(el) ? ok : no("This element can't be removed because its position is controlled by React code.")),
    duplicate: structuralBlock ?? (directChild ? ok : no("This element can't be duplicated because its position is controlled by React code.")),
    move: structuralBlock ?? (directChild ? ok : no("This element can't be moved because its layout is controlled by React code.")),
    addInside:
      VOID_TAGS.has(el.tag) || el.source !== "native"
        ? no("This element can't contain other elements.")
        : repeated
          ? no("This element is rendered from a list in React code.")
          : !CONTAINER_TAGS.has(el.tag) && !TEXT_TAGS.has(el.tag)
            ? no("Add elements inside a container like a section or div.")
            : ok,
    addAfter: structuralBlock ?? (directChild ? ok : no("Elements can't be added here because the position is controlled by React code.")),
  };

  return {
    id: el.id,
    file: analysis.file,
    line: el.node.loc?.start.line ?? 0,
    tag: el.tag,
    source: el.source as ElementSource,
    parentId: el.parent ? el.parent.id : null,
    text,
    attributes,
    hasSpread,
    styleId,
    inlineStyle,
    repeated,
    conditional,
    isRoot,
    containsChildrenSlot,
    shared: ctx.shared,
    ops,
  };
}

/**
 * Pairs of (node, parent) strictly between the element and its parent element.
 * For a root element the chain runs up to and including the nearest enclosing function.
 */
function chainToParent(el: SourceElement): Array<[Node, Node | undefined]> {
  const a = el.ancestors;
  let stop = -1;
  if (el.parent) {
    stop = a.lastIndexOf(el.parent.node);
  } else {
    for (let i = a.length - 1; i >= 0; i--) {
      if (t.isFunction(a[i])) {
        stop = i - 1;
        break;
      }
    }
  }
  const pairs: Array<[Node, Node | undefined]> = [];
  for (let i = stop + 1; i < a.length; i++) pairs.push([a[i], a[i - 1]]);
  return pairs;
}

/** The element sits inside a callback such as `items.map(() => ...)` between it and its parent. */
function isRepeated(el: SourceElement): boolean {
  return chainToParent(el).some(([node, parent]) => t.isFunction(node) && (t.isCallExpression(parent) || t.isNewExpression(parent)));
}

const repeatedCache = new WeakMap<SourceElement, boolean>();
function isRepeatedDeep(el: SourceElement): boolean {
  const cached = repeatedCache.get(el);
  if (cached !== undefined) return cached;
  const value = isRepeated(el) || (el.parent ? isRepeatedDeep(el.parent) : false);
  repeatedCache.set(el, value);
  return value;
}

function isConditional(el: SourceElement): boolean {
  return chainToParent(el).some(([node]) => t.isConditionalExpression(node) || t.isLogicalExpression(node));
}

function isDirectJsxChild(el: SourceElement): boolean {
  const parentNode = el.ancestors[el.ancestors.length - 1];
  return t.isJSXElement(parentNode) || t.isJSXFragment(parentNode);
}

/** `{cond && <X/>}` — the element can be removed by removing the whole expression container. */
export function isSoleLogicalBranch(el: SourceElement): boolean {
  const a = el.ancestors;
  const parent = a[a.length - 1];
  const grand = a[a.length - 2];
  const great = a[a.length - 3];
  return (
    t.isLogicalExpression(parent) &&
    parent.operator === "&&" &&
    parent.right === el.node &&
    t.isJSXExpressionContainer(grand) &&
    (t.isJSXElement(great) || t.isJSXFragment(great))
  );
}

function containsChildrenExpression(node: JSXElement): boolean {
  let found = false;
  walk(node, (n) => {
    if (found) return false;
    if (t.isJSXExpressionContainer(n)) {
      const e = n.expression;
      if (t.isIdentifier(e, { name: "children" })) found = true;
      if (t.isMemberExpression(e) && t.isIdentifier(e.property, { name: "children" })) found = true;
    }
    return;
  });
  return found;
}

export function readAttributes(node: JSXElement): Record<string, AttrValue> {
  const result: Record<string, AttrValue> = {};
  for (const attr of node.openingElement.attributes) {
    if (!t.isJSXAttribute(attr)) continue;
    const name = t.isJSXIdentifier(attr.name) ? attr.name.name : `${attr.name.namespace.name}:${attr.name.name.name}`;
    const value = attr.value;
    if (value === null || value === undefined) {
      result[name] = { kind: "static", value: "true" };
    } else if (t.isStringLiteral(value)) {
      result[name] = { kind: "static", value: value.value };
    } else if (t.isJSXExpressionContainer(value)) {
      const e = value.expression;
      if (t.isStringLiteral(e)) result[name] = { kind: "static", value: e.value };
      else if (t.isNumericLiteral(e)) result[name] = { kind: "static", value: String(e.value) };
      else if (t.isBooleanLiteral(e)) result[name] = { kind: "static", value: String(e.value) };
      else if (t.isTemplateLiteral(e) && e.expressions.length === 0) result[name] = { kind: "static", value: e.quasis[0]?.value.cooked ?? "" };
      else result[name] = { kind: "dynamic", preview: truncate(recast.print(e).code, 80) };
    } else {
      result[name] = { kind: "dynamic", preview: truncate(recast.print(value).code, 80) };
    }
  }
  return result;
}

function describeInlineStyle(node: JSXElement): ElementInfo["inlineStyle"] {
  const attr = node.openingElement.attributes.find(
    (a): a is t.JSXAttribute => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name, { name: "style" }),
  );
  if (!attr) return null;
  if (!t.isJSXExpressionContainer(attr.value) || !t.isObjectExpression(attr.value.expression)) return { kind: "dynamic" };
  const values: Record<string, string> = {};
  for (const prop of attr.value.expression.properties) {
    if (!t.isObjectProperty(prop) || prop.computed) return { kind: "dynamic" };
    const key = t.isIdentifier(prop.key) ? prop.key.name : t.isStringLiteral(prop.key) ? prop.key.value : null;
    if (key === null) return { kind: "dynamic" };
    if (t.isStringLiteral(prop.value)) values[camelToKebab(key)] = prop.value.value;
    else if (t.isNumericLiteral(prop.value)) values[camelToKebab(key)] = UNITLESS.has(key) ? String(prop.value.value) : `${prop.value.value}px`;
    else return { kind: "dynamic" };
  }
  return { kind: "static", values };
}

const UNITLESS = new Set(["opacity", "zIndex", "fontWeight", "lineHeight", "flex", "flexGrow", "flexShrink", "order"]);

export function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

export function kebabToCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

export type TextChild =
  | { kind: "text"; node: t.JSXText; value: string }
  | { kind: "string"; node: t.JSXExpressionContainer; value: string };

/**
 * Classify children as plain text when every meaningful child is a JSX text node or a
 * string literal expression. Anything else (elements, variables, calls) makes text read-only.
 */
export function textChildren(node: JSXElement): { children: TextChild[]; blocker: Node | null } {
  const children: TextChild[] = [];
  for (const child of node.children) {
    if (t.isJSXText(child)) {
      const value = cleanJsxText(child.value);
      if (value === null) continue; // whitespace-only line break
      children.push({ kind: "text", node: child, value });
    } else if (t.isJSXExpressionContainer(child)) {
      const e = child.expression;
      if (t.isJSXEmptyExpression(e)) continue; // comment
      if (t.isStringLiteral(e)) children.push({ kind: "string", node: child, value: e.value });
      else if (t.isTemplateLiteral(e) && e.expressions.length === 0) children.push({ kind: "string", node: child, value: e.quasis[0]?.value.cooked ?? "" });
      else return { children, blocker: e };
    } else {
      return { children, blocker: child };
    }
  }
  return { children, blocker: null };
}

/** `{...props}` or `children={…}` can hand the element its content from wherever it's used. */
function childrenFromProps(node: JSXElement): boolean {
  return node.openingElement.attributes.some(
    (a) => t.isJSXSpreadAttribute(a) || (t.isJSXAttribute(a) && t.isJSXIdentifier(a.name, { name: "children" })),
  );
}

const PROPS_TEXT_REASON = "This text is passed in from where the component is used.";

function describeText(el: SourceElement): ElementText {
  // No children written here, but props may supply them: writing text would override every use.
  if (el.node.children.length === 0 && childrenFromProps(el.node) && !VOID_TAGS.has(el.tag)) {
    return { kind: "readonly", reason: PROPS_TEXT_REASON };
  }
  if (el.source !== "native") {
    if (el.source === "next-link") {
      const { children, blocker } = textChildren(el.node);
      if (blocker) return { kind: "readonly", reason: readonlyReason(blocker), preview: truncate(recast.print(blocker).code, 60) };
      return { kind: "editable", value: children.map((c) => c.value).join("") };
    }
    return { kind: "none" };
  }
  if (VOID_TAGS.has(el.tag)) return { kind: "none" };
  const { children, blocker } = textChildren(el.node);
  if (blocker) {
    // A container whose children are elements or expressions simply has no text of its own.
    if (children.length === 0 && !TEXT_TAGS.has(el.tag)) return { kind: "none" };
    if (t.isJSXElement(blocker) || t.isJSXFragment(blocker)) {
      return { kind: "readonly", reason: "This text contains nested elements. Select the inner element to edit its text." };
    }
    return { kind: "readonly", reason: readonlyReason(blocker), preview: truncate(recast.print(blocker).code, 60) };
  }
  if (children.length === 0 && !TEXT_TAGS.has(el.tag)) return { kind: "none" };
  return { kind: "editable", value: children.map((c) => c.value).join("") };
}

function readonlyReason(blocker: Node): string {
  if (t.isJSXElement(blocker) || t.isJSXFragment(blocker)) return "This text contains nested elements.";
  return "This content comes from JavaScript and can't be edited visually.";
}

/**
 * Mirror React's JSX whitespace rules: trim each line, drop whitespace-only lines that contain a
 * newline, and join the remaining lines with single spaces. Returns null for removable whitespace.
 */
export function cleanJsxText(raw: string): string | null {
  const lines = raw.split(/\r\n|\n|\r/);
  let result = "";
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const isFirst = i === 0;
    const isLast = i === lines.length - 1;
    if (!isFirst) line = line.replace(/^[ \t]+/, "");
    if (!isLast) line = line.replace(/[ \t]+$/, "");
    if (line) {
      if (result) result += " ";
      result += line;
    }
  }
  if (result === "" && lines.length > 1) return null;
  return decodeEntities(result);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

export function truncate(s: string, max: number): string {
  const single = s.replace(/\s+/g, " ").trim();
  return single.length > max ? single.slice(0, max - 1) + "…" : single;
}
