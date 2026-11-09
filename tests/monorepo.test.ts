import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateProject } from "@/lib/project/validation";
import { findNextApps } from "@/lib/project/find-apps";
import { Workspace } from "@/lib/preview/workspace";

let repo: string;

async function write(rel: string, content: string) {
  await fs.mkdir(path.dirname(path.join(repo, rel)), { recursive: true });
  await fs.writeFile(path.join(repo, rel), content);
}

beforeAll(async () => {
  repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "framekit-mono-")));
  await write("package.json", JSON.stringify({ name: "mono", private: true, workspaces: ["apps/*", "packages/*"] }));
  await write("package-lock.json", "{}");
  // Hoisted install: next lives only at the repo root.
  await write("node_modules/next/package.json", '{"name":"next"}');
  await write("apps/web/package.json", JSON.stringify({ name: "web", dependencies: { next: "16.4.5" } }));
  await write("apps/web/app/layout.tsx", "export default function L({ children }) { return <html><body>{children}</body></html>; }");
  await write("apps/web/app/page.tsx", "export default function P() { return <main />; }");
  await write("apps/site/package.json", JSON.stringify({ name: "site", dependencies: { next: "16.4.5" } }));
  await write("apps/site/src/app/layout.tsx", "export default function L({ children }) { return <html><body>{children}</body></html>; }");
  await write("apps/docs/package.json", JSON.stringify({ name: "docs", dependencies: { next: "16.4.5" } }));
  await write("apps/docs/pages/index.tsx", "export default function P() { return null; }");
  await write("packages/ui/package.json", JSON.stringify({ name: "@repo/ui" }));
  // i18n app: no app/layout, the root layout lives under [locale].
  await write("apps/intl/package.json", JSON.stringify({ name: "intl", dependencies: { next: "16.4.5" } }));
  await write("apps/intl/src/app/[locale]/layout.tsx", "export default function L({ children }) { return <html lang=\"en\"><body>{children}</body></html>; }");
  await write("apps/intl/src/app/[locale]/(site)/layout.tsx", "export default function L({ children }) { return <div>{children}</div>; }");
  await write("apps/intl/src/app/[locale]/(site)/page.tsx", "export default function P() { return <main />; }");
});

afterAll(async () => {
  await fs.rm(repo, { recursive: true, force: true });
});

describe("monorepos", () => {
  it("finds Next.js apps inside a folder, App Router first", async () => {
    const apps = await findNextApps(repo);
    expect(apps.map((a) => [a.relative, a.name, a.router])).toEqual([
      ["apps/intl", "intl", "app"],
      ["apps/site", "site", "app"],
      ["apps/web", "web", "app"],
      ["apps/docs", "docs", "pages"],
    ]);
  });

  it("rejects the repo root but opens an app inside it", async () => {
    await expect(validateProject(repo)).rejects.toMatchObject({ info: { code: "MONOREPO" } });
    const project = await validateProject(path.join(repo, "apps/web"));
    expect(project.repoRoot).toBe(repo);
    expect(project.name).toBe("web");
  });

  it("finds a root layout nested under a dynamic segment", async () => {
    const project = await validateProject(path.join(repo, "apps/intl"));
    expect(project.rootLayoutFile).toBe("src/app/[locale]/layout.tsx");
  });

  it("places the app at its relative path inside the mirrored workspace", async () => {
    const workspace = new Workspace(await validateProject(path.join(repo, "apps/web")));
    expect(path.relative(workspace.mirrorRoot, workspace.dir)).toBe(path.join("apps", "web"));
  });
});
