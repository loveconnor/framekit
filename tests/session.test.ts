import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateProject } from "@/lib/project/validation";
import { discoverRoutes } from "@/lib/project/discovery";
import { ProjectSession } from "@/lib/session/session";

const FIXTURE = path.resolve(__dirname, "../fixtures/marketing-site");
let tempRoot: string;
let home: string;

/** Copy the fixture (without node_modules) into a temp dir so save() can write freely. */
async function copyFixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "framekit-fixture-"));
  await fs.cp(FIXTURE, dir, {
    recursive: true,
    filter: (src) => !src.includes("node_modules") && !src.includes(".next"),
  });
  // validation needs node_modules/next/package.json to exist
  await fs.mkdir(path.join(dir, "node_modules", "next"), { recursive: true });
  await fs.writeFile(path.join(dir, "node_modules", "next", "package.json"), '{"name":"next"}');
  return dir;
}

type SessionInternals = {
  loadAliases(): Promise<void>;
  loadSourceFiles(): Promise<void>;
  loadStylesheet(): Promise<void>;
  buildImportGraph(): void;
  isShared(rel: string): boolean;
  instrumentForWorkspace(rel: string, content: string): string | null;
  files: Map<string, { draft: string }>;
  phase: string;
};

async function prepared(): Promise<{ session: ProjectSession; internals: SessionInternals }> {
  const project = await validateProject(tempRoot);
  const session = new ProjectSession(project, "http://127.0.0.1:3000");
  const internals = session as unknown as SessionInternals;
  await internals.loadAliases();
  await internals.loadSourceFiles();
  await internals.loadStylesheet();
  internals.buildImportGraph();
  for (const [rel, file] of internals.files) internals.instrumentForWorkspace(rel, file.draft);
  internals.phase = "ready";
  // Workspace writes go to a throwaway dir under the temp home.
  (session.workspace as unknown as { dir: string }).dir = path.join(home, "ws");
  return { session, internals };
}

beforeAll(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "framekit-home-"));
  process.env.FRAMEKIT_HOME = home;
  tempRoot = await copyFixture();
});

afterAll(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.rm(home, { recursive: true, force: true });
});

describe("project validation and discovery", () => {
  it("validates the fixture and finds routes", async () => {
    const project = await validateProject(tempRoot);
    expect(project.appDirRelative).toBe("app");
    expect(project.rootLayoutFile).toBe("app/layout.tsx");
    const routes = await discoverRoutes(project);
    expect(routes.map((r) => r.pattern)).toEqual(["/", "/about", "/blog/[slug]"]);
    expect(routes[2].dynamic).toBe(true);
  });

  it("explains a missing directory and a non-Next project", async () => {
    await expect(validateProject("/definitely/not/here")).rejects.toMatchObject({ info: { code: "NOT_FOUND" } });
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), "plain-"));
    await fs.writeFile(path.join(plain, "package.json"), '{"name":"x","dependencies":{}}');
    await expect(validateProject(plain)).rejects.toMatchObject({ info: { code: "NOT_NEXT" } });
  });
});

describe("session", () => {
  it("marks components imported from several files as shared", async () => {
    const { internals } = await prepared();
    expect(internals.isShared("components/button.tsx")).toBe(true);
    expect(internals.isShared("components/footer.tsx")).toBe(true); // imported by the layout
    expect(internals.isShared("app/page.tsx")).toBe(false);
  });

  it("inherits repeated state and gives containers no text of their own", async () => {
    const { session } = await prepared();
    const elements = session.snapshot().elements;
    const h3InList = elements.find((e) => e.file === "app/page.tsx" && e.tag === "h3" && e.repeated);
    expect(h3InList).toBeDefined();
    expect(h3InList!.ops.delete.allowed).toBe(false);
    const rootDiv = elements.find((e) => e.file === "app/page.tsx" && e.isRoot)!;
    expect(rootDiv.text.kind).toBe("none");
  });

  it("applies a text edit, saves it to the original project with a backup, and detects external changes", async () => {
    const { session } = await prepared();
    const h1 = session.snapshot().elements.find((e) => e.file === "app/page.tsx" && e.tag === "h1")!;
    const result = await session.apply({ type: "SET_TEXT", nodeId: h1.id, value: "Hello there" }, 0, undefined);
    expect(result.isDirty).toBe(true);
    const workspaceFile = await fs.readFile(path.join(home, "ws", "app", "page.tsx"), "utf8");
    expect(workspaceFile).toContain("Hello there");
    expect(workspaceFile).toContain("data-fk-id=");

    await session.apply({ type: "SET_STYLE", nodeId: h1.id, breakpoint: "desktop", property: "color", value: "#123456" }, 1, undefined);
    const saved = await session.save();
    expect(saved.files.sort()).toEqual(["app/layout.tsx", "app/page.tsx", "framekit/styles.css"].sort());
    const original = await fs.readFile(path.join(tempRoot, "app/page.tsx"), "utf8");
    expect(original).toContain("Hello there");
    expect(original).not.toContain("data-fk-id");
    expect(original).toContain('data-fk-style="fk-');
    expect(await fs.readFile(path.join(tempRoot, "app/layout.tsx"), "utf8")).toContain('import "../framekit/styles.css";');
    expect(await fs.readFile(path.join(tempRoot, "framekit/styles.css"), "utf8")).toContain("color: #123456");
    expect(saved.backupDir).toBeTruthy();
    expect(await fs.readFile(path.join(saved.backupDir!, "app/page.tsx"), "utf8")).toContain("Design for companies");
    expect(session.isDirty).toBe(false);

    // External modification is refused.
    await fs.appendFile(path.join(tempRoot, "app/page.tsx"), "\n// edited outside\n");
    await session.apply({ type: "SET_TEXT", nodeId: h1.id, value: "Again" }, 2, undefined);
    await expect(session.save()).rejects.toMatchObject({ code: "EXTERNAL_CHANGE" });
  });

  it("refuses unsafe link schemes and unsupported structural edits", async () => {
    const { session } = await prepared();
    const els = session.snapshot().elements;
    const link = els.find((e) => e.file === "components/header.tsx" && e.source === "next-link")!;
    await expect(
      session.apply({ type: "SET_ATTRIBUTE", nodeId: link.id, name: "href", value: "javascript:alert(1)" }, undefined, undefined),
    ).rejects.toMatchObject({ code: "INVALID_VALUE" });
    const li = els.find((e) => e.file === "app/page.tsx" && e.tag === "li")!;
    await expect(session.apply({ type: "DELETE_NODE", nodeId: li.id }, undefined, undefined)).rejects.toThrow(/list in React code/);
  });

  it("adds, duplicates, moves and deletes with undo", async () => {
    const { session } = await prepared();
    const els = session.snapshot().elements;
    const hero = els.find((e) => e.file === "app/page.tsx" && e.tag === "section")!;
    const added = await session.apply({ type: "ADD_NODE", targetId: hero.id, placement: "inside", elementType: "paragraph" }, undefined, undefined);
    expect(added.selectedId).toBeTruthy();
    const newEl = added.elements.find((e) => e.id === added.selectedId)!;
    expect(newEl.tag).toBe("p");
    expect(newEl.text).toEqual({ kind: "editable", value: "Write something here." });

    const dup = await session.apply({ type: "DUPLICATE_NODE", nodeId: newEl.id }, undefined, undefined);
    expect(dup.elements.filter((e) => e.text.kind === "editable" && e.text.value === "Write something here.").length).toBe(2);

    const h1 = dup.elements.find((e) => e.tag === "h1")!;
    const column = dup.elements.find((e) => e.id === h1.parentId)!;
    const moved = await session.apply({ type: "MOVE_NODE", nodeId: h1.id, targetParentId: column.id, position: 1 }, undefined, undefined);
    const movedH1 = moved.elements.find((e) => e.id === moved.selectedId)!;
    expect(movedH1.tag).toBe("h1");
    expect(movedH1.id.endsWith(".1")).toBe(true);

    const deleted = await session.apply({ type: "DELETE_NODE", nodeId: movedH1.id }, undefined, undefined);
    expect(deleted.elements.some((e) => e.tag === "h1" && e.file === "app/page.tsx")).toBe(false);

    const undone = await session.undo();
    expect(undone.elements.some((e) => e.tag === "h1" && e.file === "app/page.tsx")).toBe(true);
  });
});
