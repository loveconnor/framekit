import * as t from "@babel/types";
import type { File } from "@babel/types";
import * as recast from "recast";
import { parseSource } from "./parser";
import { analyzeFile, FK_ID_ATTR, isInstrumentable, type AnalyzeOptions, type FileAnalysis } from "./analysis";

export type InstrumentOptions = {
  /**
   * Append the editor bridge to <body>. Only the root layout gets this. The script is inlined, not
   * loaded by URL, so the project's rewrites, proxy/middleware or basePath can never 404 it.
   */
  injectBridge?: { editorOrigin: string; source: string };
  /** See AnalyzeOptions: lets imported styled elements count as the HTML elements they render. */
  resolveImportedTag?: AnalyzeOptions["resolveImportedTag"];
};

export type InstrumentResult = {
  code: string;
  analysis: FileAnalysis;
};

/**
 * Produce the preview copy of a source file: every native JSX element gets a `data-fk-id`
 * so the browser bridge can report which source element a DOM node came from.
 * The draft and original files never receive these attributes.
 */
export function instrumentSource(code: string, file: string, options: InstrumentOptions = {}): InstrumentResult {
  const parsed = parseSource(code, file);
  const analysis = analyzeFile(parsed.ast, file, { resolveImportedTag: options.resolveImportedTag });

  for (const el of analysis.elements) {
    if (!isInstrumentable(el)) continue;
    const attrs = el.node.openingElement.attributes;
    const existing = attrs.findIndex((a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name, { name: FK_ID_ATTR }));
    const attr = t.jsxAttribute(t.jsxIdentifier(FK_ID_ATTR), t.stringLiteral(el.id));
    if (existing >= 0) attrs.splice(existing, 1, attr);
    else attrs.push(attr);
  }

  if (options.injectBridge) injectBridge(parsed.ast, options.injectBridge.editorOrigin, options.injectBridge.source);

  return { code: recast.print(parsed.ast).code, analysis };
}

function injectBridge(ast: File, editorOrigin: string, source: string): void {
  let injected = false;
  recast.visit(ast, {
    visitJSXElement(path) {
      const node = path.node as unknown as t.JSXElement;
      if (!injected && t.isJSXIdentifier(node.openingElement.name, { name: "body" })) {
        const script = t.jsxElement(
          t.jsxOpeningElement(
            t.jsxIdentifier("script"),
            [
              t.jsxAttribute(t.jsxIdentifier("data-editor-origins"), t.stringLiteral(allowedEditorOrigins(editorOrigin).join(" "))),
              t.jsxAttribute(
                t.jsxIdentifier("dangerouslySetInnerHTML"),
                t.jsxExpressionContainer(t.objectExpression([t.objectProperty(t.identifier("__html"), t.stringLiteral(source))])),
              ),
            ],
            true,
          ),
          null,
          [],
        );
        node.children.push(script);
        if (node.openingElement.selfClosing) {
          node.openingElement.selfClosing = false;
          node.closingElement = t.jsxClosingElement(t.jsxIdentifier("body"));
        }
        injected = true;
        return false;
      }
      this.traverse(path);
    },
  });
}

/**
 * The editor may be reached as 127.0.0.1 or localhost on the same port; the bridge accepts both
 * and locks onto whichever the parent window actually uses.
 */
export function allowedEditorOrigins(editorOrigin: string): string[] {
  try {
    const url = new URL(editorOrigin);
    const port = url.port ? `:${url.port}` : "";
    const hosts = new Set([url.hostname, "127.0.0.1", "localhost"]);
    return [...hosts].map((host) => `${url.protocol}//${host}${port}`);
  } catch {
    return [editorOrigin];
  }
}

/** Whether the root layout has a native <body> the bridge can attach to. */
export function hasBodyElement(code: string, file: string): boolean {
  const parsed = parseSource(code, file);
  const analysis = analyzeFile(parsed.ast, file);
  return analysis.elements.some((e) => e.tag === "body" && e.source === "native");
}
