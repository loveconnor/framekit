/** Human-friendly names for elements, shared by the Layers panel, hover label, and inspector. */
const TAG_LABELS: Record<string, string> = {
  body: "Body",
  main: "Main",
  header: "Header",
  footer: "Footer",
  nav: "Navigation",
  aside: "Sidebar",
  section: "Section",
  article: "Article",
  div: "Container",
  span: "Text",
  h1: "H1 Heading",
  h2: "H2 Heading",
  h3: "H3 Heading",
  h4: "H4 Heading",
  h5: "H5 Heading",
  h6: "H6 Heading",
  p: "Paragraph",
  a: "Link",
  button: "Button",
  img: "Image",
  picture: "Picture",
  video: "Video",
  svg: "Vector",
  ul: "List",
  ol: "Numbered list",
  li: "List item",
  form: "Form",
  input: "Input",
  textarea: "Text area",
  select: "Select",
  label: "Label",
  table: "Table",
  blockquote: "Quote",
  code: "Code",
  pre: "Code block",
  strong: "Bold text",
  em: "Italic text",
  small: "Small text",
  figure: "Figure",
  figcaption: "Caption",
  hr: "Divider",
  iframe: "Embed",
};

export function labelForTag(tag: string): string {
  return TAG_LABELS[tag] ?? tag.charAt(0).toUpperCase() + tag.slice(1);
}

export const VOID_TAGS = new Set([
  "img", "br", "hr", "input", "area", "base", "col", "embed", "link", "meta", "param", "source", "track", "wbr",
]);

/** Tags whose text content Framekit edits directly, even when the element is currently empty. */
export const TEXT_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "button", "li", "label", "td", "th",
  "blockquote", "code", "strong", "em", "small", "figcaption", "dt", "dd", "summary", "legend", "caption", "pre",
]);

export const CONTAINER_TAGS = new Set([
  "body", "main", "header", "footer", "nav", "aside", "section", "article", "div", "ul", "ol", "li", "form", "figure", "fieldset", "details",
]);
