import { describe, expect, it } from "vitest";
import { instrumentSource } from "@/lib/source/instrument";
import { analyzeFile, describeElement, cleanJsxText, isInstrumentable } from "@/lib/source/analysis";
import { parseSource } from "@/lib/source/parser";
import { ELEMENT_CATALOG } from "@/lib/source/element-catalog";
import {
  openForMutation, requireElement, finish, setText, setAttribute, ensureStyleId, deleteElement, duplicateElement,
  moveElement, insertNewElement, setTag, setInlineStyleProperty, NEW_ELEMENT_STYLES,
} from "@/lib/source/mutations";
import { serializeStylesheet, parseStylesheet, setStyle, validateDeclaration } from "@/lib/styles/stylesheet";

const PAGE = `import Image from "next/image";

const items = [{ id: 1, title: "One" }];

export default function Page({ children }: { children: React.ReactNode }) {
  return (
    <main className="wrap">
      <h1 className="text-5xl">Build faster.</h1>
      <p>
        Looking for a starting point? Head over to{" "}
        <a href="/docs">Docs</a> or the center.
      </p>
      <Image src="/hero.png" alt="Hero" width={100} height={20} />
      <ul>
        {items.map((item) => (
          <li key={item.id}>{item.title}</li>
        ))}
      </ul>
      <div style={{ maxWidth: 480, color: 'red' }}>{children}</div>
    </main>
  );
}
`;

function elements(code: string, file = "app/page.tsx") {
  const { ast } = parseSource(code, file);
  const analysis = analyzeFile(ast, file);
  return { analysis, infos: analysis.elements.filter(isInstrumentable).map((e) => describeElement(e, analysis, { shared: false })) };
}

describe("analysis", () => {
  it("treats styled and motion elements as the HTML elements they render", () => {
    const code = [
      'import { styled } from "@linaria/react";',
      'import { motion } from "motion/react";',
      'import { Card, Pair } from "@/ui";',
      'import Link from "next/link";',
      "const StepTitle = styled.h3`font-size: 2rem;`;",
      'const Body = styled("p")`color: gray;`;',
      "const Big = styled(StepTitle)<{ big: boolean }>`font-size: 3rem;`;",
      "const NavLink = styled(Link)`color: blue;`;",
      "export const Badge = styled.span.attrs({ role: 'note' })`padding: 4px;`;",
      "export function Step({ title }) {",
      "  return (",
      "    <Pair>",
      "      <StepTitle>{title}</StepTitle>",
      "      <Body>Hello</Body>",
      "      <Big>Wow</Big>",
      "      <NavLink href=\"/\">Home</NavLink>",
      "      <motion.span>Hi</motion.span>",
      "      <Card>Not styled</Card>",
      "    </Pair>",
      "  );",
      "}",
    ].join("\n");
    const { ast } = parseSource(code, "sections/step.tsx");
    const analysis = analyzeFile(ast, "sections/step.tsx", {
      resolveImportedTag: (source, name) => (source === "@/ui" && name === "Pair" ? "div" : null),
    });
    expect(analysis.elements.map((e) => [e.componentName ?? e.tag, e.tag, e.source, e.tagFrom ?? null])).toEqual([
      ["Pair", "div", "native", "styled"],
      ["StepTitle", "h3", "native", "styled"],
      ["Body", "p", "native", "styled"],
      ["Big", "h3", "native", "styled"],
      ["NavLink", "NavLink", "component", null],
      ["motion.span", "span", "native", "motion"],
      ["Card", "Card", "component", null],
    ]);
    expect([...analysis.exportedTags]).toEqual([["Badge", "span"]]);
    const info = describeElement(analysis.elements[1], analysis, { shared: false });
    expect(info.text.kind).toBe("readonly"); // {title}: traced to its source string by the inspector
    expect(info.ops.setTag.allowed).toBe(false);
    const out = instrumentSource(code, "sections/step.tsx", {}).code;
    expect(out).toMatch(/<StepTitle data-fk-id="[^"]+">/);
  });

  it("treats a polymorphic tag variable as the HTML element it defaults to", () => {
    const code = [
      'export function Body({ as: Tag = "p", children }) {',
      "  return <Tag className=\"body\">{children}</Tag>;",
      "}",
      "export function Title({ level }) {",
      '  const Heading = level === 1 ? "h1" : "h2";',
      "  return <Heading>Hi</Heading>;",
      "}",
      "export function Maybe({ href }) {",
      '  const Comp = href ? Link : "span";',
      "  return <Comp>Hi</Comp>;",
      "}",
      "export function Box({ as: Box2, children }) {",
      "  return <Box2>{children}</Box2>;",
      "}",
    ].join("\n");
    const { analysis, infos } = elements(code, "ui/body.tsx");
    expect(analysis.elements.map((e) => [e.tag, e.source])).toEqual([
      ["p", "native"],
      ["h1", "native"],
      ["Comp", "component"],
      ["Box2", "component"],
    ]);
    // Instrumented and traceable, but the JSX name must never be rewritten.
    expect(infos.map((i) => i.tag)).toEqual(["p", "h1"]);
    expect(infos[1].ops.setTag.allowed).toBe(false);
    const out = instrumentSource(code, "ui/body.tsx", {}).code;
    expect(out).toMatch(/<Tag className="body" data-fk-id="[^"]+"/);
  });

  it("treats a childless element with spread props as text passed in, not empty editable text", () => {
    const code = `import Link from "next/link";\nexport function LocalizedLink(props) {\n  return <Link {...props} href="/x" />;\n}\nexport function P(props) {\n  return <p {...props} />;\n}\nexport function Empty() {\n  return <p className="a" />;\n}\n`;
    const { infos } = elements(code, "components/links.tsx");
    const [link, p, empty] = infos;
    expect(link.text).toEqual({ kind: "readonly", reason: "This text is passed in from where the component is used." });
    expect(link.ops.setText.allowed).toBe(false);
    expect(p.text.kind).toBe("readonly");
    expect(empty.text).toEqual({ kind: "editable", value: "" });
  });

  it("assigns structural ids and classifies text", () => {
    const { infos } = elements(PAGE);
    const h1 = infos.find((i) => i.tag === "h1")!;
    expect(h1.id).toMatch(/^[a-z0-9]+:0\.0$/);
    expect(h1.text).toEqual({ kind: "editable", value: "Build faster." });
    const p = infos.find((i) => i.tag === "p")!;
    expect(p.text.kind).toBe("readonly");
    const a = infos.find((i) => i.tag === "a")!;
    expect(a.attributes.href).toEqual({ kind: "static", value: "/docs" });
    expect(a.text).toEqual({ kind: "editable", value: "Docs" });
  });

  it("marks next/image as an image and reads numeric props", () => {
    const { infos } = elements(PAGE);
    const img = infos.find((i) => i.source === "next-image")!;
    expect(img.tag).toBe("img");
    expect(img.attributes.width).toEqual({ kind: "static", value: "100" });
  });

  it("detects repeated and children-slot elements", () => {
    const { infos } = elements(PAGE);
    const li = infos.find((i) => i.tag === "li")!;
    expect(li.repeated).toBe(true);
    expect(li.ops.delete.allowed).toBe(false);
    expect(li.text.kind).toBe("readonly");
    const div = infos.find((i) => i.tag === "div")!;
    expect(div.containsChildrenSlot).toBe(true);
    expect(div.ops.delete.allowed).toBe(false);
    expect(div.inlineStyle).toEqual({ kind: "static", values: { "max-width": "480px", color: "red" } });
    const main = infos.find((i) => i.tag === "main")!;
    expect(main.isRoot).toBe(true);
    expect(main.ops.delete.allowed).toBe(false);
  });

  it("cleans JSX text like React", () => {
    expect(cleanJsxText("\n        Hello\n        world\n      ")).toBe("Hello world");
    expect(cleanJsxText("\n      ")).toBeNull();
    expect(cleanJsxText(" a ")).toBe(" a ");
  });
});

describe("instrumentation", () => {
  it("adds data-fk-id to native elements only and leaves the rest untouched", () => {
    const { code, analysis } = instrumentSource(PAGE, "app/page.tsx");
    expect(code).toContain('data-fk-id="');
    expect((code.match(/data-fk-id=/g) ?? []).length).toBe(analysis.elements.filter(isInstrumentable).length);
    expect(code).toContain("items.map((item) =>");
    expect(code).toMatch(/<Image\s+src="\/hero.png"/);
  });

  it("injects the bridge into body", () => {
    const layout = `export default function Layout({ children }) {\n  return (\n    <html>\n      <body>{children}</body>\n    </html>\n  );\n}\n`;
    const { code } = instrumentSource(layout, "app/layout.tsx", { injectBridge: { editorOrigin: "http://127.0.0.1:3000", source: 'console.log("bridge");' } });
    // Inlined, so the project's rewrites or middleware can't 404 it.
    expect(code.replace(/\s+/g, " ")).toContain('<script data-editor-origins="http://127.0.0.1:3000 http://localhost:3000" dangerouslySetInnerHTML={{ __html: "console.log(\\"bridge\\");" }} />');
  });
});

describe("mutations", () => {
  it("replaces text and preserves the rest of the file byte for byte", () => {
    const m = openForMutation(PAGE, "app/page.tsx");
    const h1 = m.analysis.elements.find((e) => e.tag === "h1")!;
    setText(h1, "Ship sooner & smile {today}");
    const out = finish(m);
    expect(out).toContain("<h1 className=\"text-5xl\">Ship sooner &amp; smile &#123;today&#125;</h1>");
    expect(out.replace(/<h1[^]*?<\/h1>/, "")).toBe(PAGE.replace(/<h1[^]*?<\/h1>/, ""));
  });

  it("edits static attributes and refuses dynamic ones", () => {
    const m = openForMutation(PAGE, "app/page.tsx");
    const a = m.analysis.elements.find((e) => e.tag === "a")!;
    setAttribute(a, "href", "/contact");
    setAttribute(a, "target", "_blank");
    const out = finish(m);
    expect(out).toContain('<a href="/contact" target="_blank">Docs</a>');
    const m2 = openForMutation(PAGE.replace('href="/docs"', "href={url}"), "app/page.tsx");
    const a2 = m2.analysis.elements.find((e) => e.tag === "a")!;
    expect(() => setAttribute(a2, "href", "/x")).toThrow(/computed by JavaScript/);
  });

  it("adds a style id once and removes inline properties that would block it", () => {
    const m = openForMutation(PAGE, "app/page.tsx");
    const div = m.analysis.elements.find((e) => e.tag === "div")!;
    const id = ensureStyleId(div, () => "fk-abcd");
    expect(ensureStyleId(div, () => "fk-zzzz")).toBe(id);
    expect(setInlineStyleProperty(div, "max-width", null)).toBe(true);
    const out = finish(m);
    expect(out).toContain('data-fk-style="fk-abcd"');
    expect(out.replace(/\s+/g, " ")).toContain("style={{ color: 'red' }}");
    expect(out).not.toContain("maxWidth");
  });

  it("deletes, duplicates, moves and inserts elements", () => {
    let m = openForMutation(PAGE, "app/page.tsx");
    deleteElement(m.analysis.elements.find((e) => e.tag === "p")!);
    let out = finish(m);
    expect(out).not.toContain("<p>");
    expect(out).toContain("<h1 className=\"text-5xl\">Build faster.</h1>\n      <Image");

    m = openForMutation(PAGE, "app/page.tsx");
    duplicateElement(m.analysis.elements.find((e) => e.tag === "h1")!, () => "fk-new1");
    out = finish(m);
    expect((out.match(/Build faster\./g) ?? []).length).toBe(2);

    m = openForMutation(PAGE, "app/page.tsx");
    const main = m.analysis.elements.find((e) => e.tag === "main")!;
    const h1 = m.analysis.elements.find((e) => e.tag === "h1")!;
    moveElement(h1, main, 2);
    out = finish(m);
    expect(out.indexOf("<Image")).toBeLessThan(out.indexOf("<h1"));
    expect(out.indexOf("<h1")).toBeLessThan(out.indexOf("<ul>"));

    m = openForMutation(PAGE, "app/page.tsx");
    insertNewElement(m.analysis.elements.find((e) => e.tag === "main")!, "inside", "paragraph", () => "fk-x");
    out = finish(m);
    expect(out).toContain("<p>Write something here.</p>\n    </main>");

    m = openForMutation(PAGE, "app/page.tsx");
    setTag(m.analysis.elements.find((e) => e.tag === "h1")!, "h2");
    out = finish(m);
    expect(out).toContain('<h2 className="text-5xl">Build faster.</h2>');
  });

  it("every catalog element inserts as valid, instrumentable JSX", () => {
    for (const entry of ELEMENT_CATALOG) {
      const m = openForMutation(PAGE, "app/page.tsx");
      let n = 0;
      const node = insertNewElement(m.analysis.elements.find((e) => e.tag === "main")!, "inside", entry.type, () => `fk-new${n++}`);
      const out = finish(m);
      const tag = (node.openingElement.name as { name: string }).name;
      const added = openForMutation(out, "app/page.tsx").analysis.elements.find((e) => e.tag === tag);
      expect(added, entry.type).toBeTruthy();
      expect(isInstrumentable(added!), entry.type).toBe(true);
      if (NEW_ELEMENT_STYLES[entry.type]) expect(out, entry.type).toContain('data-fk-style="fk-new0"');
    }
    // Composite elements bring their children along, each on its own line.
    const m = openForMutation(PAGE, "app/page.tsx");
    insertNewElement(m.analysis.elements.find((e) => e.tag === "main")!, "inside", "form", () => "fk-form");
    const out = finish(m);
    expect(out).toMatch(/<form data-fk-style="fk-form">\n\s+<label htmlFor="email">Email<\/label>\n\s+<input[^>]+\/>\n\s+<button type="submit">Submit<\/button>\n\s+<\/form>/);
  });

  it("deleting a `cond && <X/>` element removes the whole expression", () => {
    const code = `export function A({ show }) {\n  return (\n    <div>\n      {show && <span>Hi</span>}\n      <p>Keep</p>\n    </div>\n  );\n}\n`;
    const m = openForMutation(code, "a.tsx");
    const span = m.analysis.elements.find((e) => e.tag === "span")!;
    expect(requireElement(m, span.id)).toBe(span);
    deleteElement(span);
    const out = finish(m);
    expect(out).not.toContain("show &&");
    expect(out).toContain("<p>Keep</p>");
  });
});

describe("stylesheet", () => {
  it("serializes deterministically and round-trips", () => {
    let model = {};
    model = setStyle(model, "fk-b", "desktop", "font-size", "56px");
    model = setStyle(model, "fk-a", "mobile", "font-size", "32px");
    model = setStyle(model, "fk-a", "desktop", "color", "#111");
    const css = serializeStylesheet(model);
    expect(css).toContain('[data-fk-style="fk-a"] {\n  color: #111;\n}');
    expect(css.indexOf("fk-a")).toBeLessThan(css.indexOf("fk-b"));
    expect(css).toContain("@media (max-width: 767px)");
    const parsed = parseStylesheet(css);
    expect(parsed.model).toEqual(model);
    expect(serializeStylesheet(setStyle(model, "fk-a", "mobile", "font-size", null))).not.toContain("767px");
  });

  it("rejects unsafe declarations", () => {
    expect(validateDeclaration("font-size", "16px")).toBeNull();
    expect(validateDeclaration("padding-top", "-4px")).toMatch(/negative/);
    expect(validateDeclaration("color", "red; } body { display:none")).toMatch(/allowed/);
    expect(validateDeclaration("behavior", "x")).toMatch(/isn't supported/);
  });
});
