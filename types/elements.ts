export type Breakpoint = "desktop" | "tablet" | "mobile";

export type AttrValue =
  | { kind: "static"; value: string }
  | { kind: "dynamic"; preview: string };

export type OpState = { allowed: boolean; reason?: string };

export type ElementText =
  | { kind: "editable"; value: string }
  | { kind: "readonly"; reason: string; preview?: string }
  | { kind: "none" };

export type ElementSource = "native" | "next-image" | "next-link";

export type ElementOps = {
  setText: OpState;
  setStyle: OpState;
  setAttribute: OpState;
  setTag: OpState;
  delete: OpState;
  duplicate: OpState;
  move: OpState;
  addInside: OpState;
  addAfter: OpState;
};

export type ElementInfo = {
  id: string;
  /** Project-relative posix path of the source file. */
  file: string;
  line: number;
  /** Rendered HTML tag (img for next/image, a for next/link). */
  tag: string;
  source: ElementSource;
  parentId: string | null;
  text: ElementText;
  attributes: Record<string, AttrValue>;
  hasSpread: boolean;
  styleId: string | null;
  inlineStyle: { kind: "static"; values: Record<string, string> } | { kind: "dynamic" } | null;
  repeated: boolean;
  conditional: boolean;
  isRoot: boolean;
  containsChildrenSlot: boolean;
  shared: boolean;
  ops: ElementOps;
};

export type StyleRules = Partial<Record<Breakpoint, Record<string, string>>>;
export type StyleSheetModel = Record<string, StyleRules>;

export const ADDABLE_ELEMENTS = [
  // Structure
  "section", "container", "grid", "flex", "header", "footer", "nav",
  // Text
  "heading", "paragraph", "text", "quote", "list", "list-item",
  // Basic
  "button", "link", "divider", "spacer",
  // Media
  "image", "video",
  // Forms
  "form", "label", "input", "textarea",
] as const;

export type AddableElement = (typeof ADDABLE_ELEMENTS)[number];
