import { describe, expect, it } from "vitest";
import { collectTextLiterals, findTextSources, normalizeText, setTextLiteral, TextSourceError } from "@/lib/source/text-sources";
import { parseSource, printSource, detectPrintOptions } from "@/lib/source/parser";

const HERO = `import { css } from '@linaria/core';
import { msg } from '@lingui/core/macro';

const title = css\`
  font-size: 44px;
\`;

export function HomeHero({ i18n }) {
  return (
    <section className="hero" aria-label="Hero">
      <Heading as="h1" size="xl">
        {i18n._(msg\`Decide where to eat, *one restaurant at a time*\`)}
      </Heading>
      <MagnetButton label="Try the app" href="/app" />
      <Card>
        Swipe to browse
      </Card>
    </section>
  );
}
`;

const rewrite = (code: string, loc: string, expected: string, value: string) => {
  const { ast } = parseSource(code, "HomeHero.tsx");
  setTextLiteral(ast, loc, expected, value, code);
  return printSource(ast, detectPrintOptions(code));
};

describe("text sources", () => {
  const literals = collectTextLiterals(HERO, "src/HomeHero.tsx");

  it("collects visible copy and skips code strings", () => {
    const values = literals.map((l) => l.value);
    expect(values).toContain("Decide where to eat, *one restaurant at a time*");
    expect(values).toContain("Try the app");
    expect(values).toContain("Swipe to browse");
    // Never rendered as visible text, so never a match: class names, links, props like size, aria-*.
    for (const code of ["hero", "Hero", "/app", "h1", "xl", "@linaria/core"]) expect(values).not.toContain(code);
    expect(values.some((v) => v.includes("font-size"))).toBe(false);
  });

  it("matches a heading split into words through its ancestor's text", () => {
    // Selected word, its accent span, then the whole heading.
    const [match] = findTextSources(literals, ["restaurant", "one restaurant at a time", "Decide where to eat, one restaurant at a time"]);
    expect(match).toMatchObject({ file: "src/HomeHero.tsx", line: 12, kind: "template", translated: true, depth: 2 });
    expect(findTextSources(literals, ["Try the app"])[0]).toMatchObject({ kind: "string", translated: false, depth: 0 });
    expect(findTextSources(literals, ["nothing like this"])).toEqual([]);
    expect(normalizeText("Decide where to eat, *one*")).toBe("decide where to eat one");
  });

  it("rewrites template, string and JSX text literals in place", () => {
    const heading = literals.find((l) => l.value.startsWith("Decide"))!;
    const out1 = rewrite(HERO, heading.loc, heading.value, "Pick a place, *one `swipe` at a time*");
    expect(out1).toContain("msg`Pick a place, *one \\`swipe\\` at a time*`");
    expect(out1).toContain("font-size: 44px;"); // untouched code round-trips

    const label = literals.find((l) => l.value === "Try the app")!;
    // Quotes can't be escaped in a JSX attribute string, so they move into an expression.
    for (const tricky of [`Get "Swipz"`, `It's here`, `Both " and '`]) {
      const out = rewrite(HERO, label.loc, label.value, tricky);
      expect(out).toMatch(/label=\{["'].+["']\}/);
      // Still valid JSX, and reading it back yields exactly the new text.
      expect(collectTextLiterals(out, "x.tsx").some((l) => l.value === tricky)).toBe(true);
    }
    expect(rewrite(HERO, label.loc, label.value, "Plain")).toContain(`label="Plain"`);

    const text = literals.find((l) => l.value === "Swipe to browse")!;
    const out3 = rewrite(HERO, text.loc, text.value, "Swipe & save");
    expect(out3).toContain("<Card>Swipe &amp; save</Card>");
  });

  it("prefers the copy whose neighbours surround the element, and never offers URLs", () => {
    const menu = `export const MENU = [\n  { href: "/#how", label: msg\`How it works\` },\n  { href: "/#team", label: msg\`Team\` },\n  { href: "/#faq", label: msg\`Questions\` },\n];\n`;
    const footer = `export const FOOTER = {\n  title: msg\`Site\`,\n  links: [\n    { label: msg\`Home\`, href: "/" },\n    { label: msg\`How it works\`, href: "/#how" },\n    { label: msg\`Team\`, href: "/#team" },\n    { label: msg\`Questions\`, href: "/#faq" },\n  ],\n  extra: msg\`Get Swipz\`,\n};\n`;
    const urls = `export const ANCHORS = { team: { href: "/#team", id: "team" } };\n`;
    const all = [...collectTextLiterals(footer, "footer.ts"), ...collectTextLiterals(urls, "urls.ts"), ...collectTextLiterals(menu, "menu.ts")];
    const matches = findTextSources(all, ["Team", "How it works Team Questions"]);
    expect(matches.map((m) => [m.file, m.value])).toEqual([["menu.ts", "Team"], ["footer.ts", "Team"]]);
    // An animated component's accessible text (second variant) matches even when the raw text repeats it.
    const blur = collectTextLiterals("export const X = <BlurText text={msg`Swipe to browse.`} />;", "hero.tsx");
    expect(findTextSources(blur, ["to", "Swipe to browse.Swipe to browse.", "Swipe to browse."])[0]).toMatchObject({ file: "hero.tsx", depth: 2 });
  });

  it("matches and edits template strings with placeholders", () => {
    const code = "export const C = ({ year }) => <p>{i18n._(msg`${year} – Swipz`)}</p>;\n";
    const lits = collectTextLiterals(code, "footer.tsx");
    const [m] = findTextSources(lits, ["2026 – Swipz"]);
    expect(m).toMatchObject({ kind: "template-expr", value: "{year} – Swipz", translated: true });
    expect(rewrite(code, m.loc, m.value, "© {year} Swipz Inc.")).toContain("msg`© ${year} Swipz Inc.`");
    expect(() => rewrite(code, m.loc, m.value, "© Swipz Inc.")).toThrow("Keep {year} in the text");
  });

  it("handles newer TypeScript syntax", () => {
    const code = `interface Props extends Base<string> { label: "a" | "b" }\nexport const x = (p: Props) => <p>Hello there</p>;\n`;
    expect(collectTextLiterals(code, "x.tsx").map((l) => l.value)).toEqual(["Hello there"]);
  });

  it("refuses to overwrite text that changed since it was read", () => {
    const label = literals.find((l) => l.value === "Try the app")!;
    expect(() => rewrite(HERO, label.loc, "Old label", "New")).toThrow(TextSourceError);
  });
});
