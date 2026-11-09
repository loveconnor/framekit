import { afterAll, beforeAll, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateProject } from "@/lib/project/validation";
import { Workspace } from "@/lib/preview/workspace";

let repo: string;
const write = async (rel: string, content: string) => {
  await fs.mkdir(path.dirname(path.join(repo, rel)), { recursive: true });
  await fs.writeFile(path.join(repo, rel), content);
};

beforeAll(async () => {
  repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "framekit-shared-")));
  // Not a workspace: the site imports a sibling app's file by relative path.
  await write("package.json", JSON.stringify({ name: "repo", private: true }));
  await write("site/package.json", JSON.stringify({ name: "site", dependencies: { next: "16.4.5" } }));
  await write("site/node_modules/next/package.json", '{"name":"next"}');
  await write("site/app/layout.tsx", "export default function L({ children }) { return <html><body>{children}</body></html>; }");
  await write("site/app/page.tsx", 'import { TERMS } from "../../mobile/src/legal.js";\nexport default function P() { return <main>{TERMS}</main>; }');
  await write("mobile/src/legal.ts", 'import { COMPANY } from "./company";\nexport const TERMS = `Terms for ${COMPANY}`;');
  await write("mobile/src/company.ts", 'export const COMPANY = "Acme";');
  await write("mobile/src/unrelated.ts", "export const X = 1;");
});

afterAll(async () => {
  await fs.rm(repo, { recursive: true, force: true });
});

it("finds files imported from outside the app, transitively", async () => {
  const project = await validateProject(path.join(repo, "site"));
  expect(project.repoKind).toBe("shared-files");
  expect(project.repoRoot).toBe(repo);
  expect(project.sharedFiles).toEqual(["mobile/src/company.ts", "mobile/src/legal.ts"]);
  const workspace = new Workspace(project);
  expect(path.relative(workspace.mirrorRoot, workspace.dir)).toBe("site");
});
