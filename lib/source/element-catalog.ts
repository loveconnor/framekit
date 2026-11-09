import type { AddableElement } from "@/types/elements";

export type ElementGroup = "Structure" | "Text" | "Basic" | "Media" | "Forms";

export type CatalogEntry = {
  type: AddableElement;
  group: ElementGroup;
  label: string;
  description: string;
};

/** Everything the Add panel can insert, in display order. Icons live in the panel; this file is server-safe. */
export const ELEMENT_CATALOG: readonly CatalogEntry[] = [
  { type: "section", group: "Structure", label: "Section", description: "Full-width page section" },
  { type: "container", group: "Structure", label: "Container", description: "A div that groups elements" },
  { type: "grid", group: "Structure", label: "Grid", description: "Two equal columns with a gap" },
  { type: "flex", group: "Structure", label: "Flex row", description: "Children side by side" },
  { type: "header", group: "Structure", label: "Header", description: "Page or section header" },
  { type: "footer", group: "Structure", label: "Footer", description: "Page or section footer" },
  { type: "nav", group: "Structure", label: "Navigation", description: "A nav landmark for links" },

  { type: "heading", group: "Text", label: "Heading", description: "H2 by default, change the level later" },
  { type: "paragraph", group: "Text", label: "Paragraph", description: "A block of text" },
  { type: "text", group: "Text", label: "Text", description: "An inline span" },
  { type: "quote", group: "Text", label: "Quote", description: "A blockquote" },
  { type: "list", group: "Text", label: "List", description: "Bulleted list with three items" },
  { type: "list-item", group: "Text", label: "List item", description: "One item, add inside a list" },

  { type: "button", group: "Basic", label: "Button", description: "A button element" },
  { type: "link", group: "Basic", label: "Link", description: "An anchor with an href" },
  { type: "divider", group: "Basic", label: "Divider", description: "A horizontal rule" },
  { type: "spacer", group: "Basic", label: "Spacer", description: "Empty block with a fixed height" },

  { type: "image", group: "Media", label: "Image", description: "An img with a placeholder" },
  { type: "video", group: "Media", label: "Video", description: "A video player, set the source later" },

  { type: "form", group: "Forms", label: "Form", description: "Label, input and submit button" },
  { type: "label", group: "Forms", label: "Label", description: "Caption for a form field" },
  { type: "input", group: "Forms", label: "Input", description: "Single-line text field" },
  { type: "textarea", group: "Forms", label: "Text area", description: "Multi-line text field" },
];

export const ELEMENT_GROUPS: readonly ElementGroup[] = ["Structure", "Text", "Basic", "Media", "Forms"];

export function catalogEntry(type: AddableElement): CatalogEntry {
  const entry = ELEMENT_CATALOG.find((e) => e.type === type);
  if (!entry) throw new Error(`Unknown element type: ${type}`);
  return entry;
}
