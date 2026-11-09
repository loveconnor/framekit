import fs from "node:fs/promises";
import path from "node:path";
import { readTextIfExists } from "@/lib/filesystem/safe-write";
import { toPosix } from "@/lib/filesystem/paths";
import { EXCLUDED_DIRS } from "@/lib/preview/workspace";

export type FoundApp = {
  /** Absolute path of the app's package directory. */
  path: string;
  name: string;
  /** Path relative to the folder that was searched, posix (e.g. `apps/web`). */
  relative: string;
  router: "app" | "pages";
};

const MAX_DEPTH = 4;
const MAX_RESULTS = 50;

/**
 * Find Next.js apps under `dir`: packages that depend on `next` and have an app/ or pages/ directory.
 * Used when the chosen folder is a monorepo (or any folder) rather than an app itself.
 * Pages Router apps are listed so the user sees why they can't be opened.
 */
export async function findNextApps(dir: string): Promise<FoundApp[]> {
  const root = await fs.realpath(dir);
  const found: FoundApp[] = [];

  const visit = async (current: string, depth: number): Promise<void> => {
    if (found.length >= MAX_RESULTS) return;
    const app = await asNextApp(current);
    if (app) {
      found.push({ path: current, name: app.name, relative: toPosix(path.relative(root, current)) || ".", router: app.router });
      return; // a Next app's own subfolders are not separate apps
    }
    if (depth >= MAX_DEPTH) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      await visit(path.join(current, entry.name), depth + 1);
    }
  };

  await visit(root, 0);
  // App Router apps first, then by path.
  return found.sort((a, b) => (a.router === b.router ? a.relative.localeCompare(b.relative) : a.router === "app" ? -1 : 1));
}

async function asNextApp(dir: string): Promise<{ name: string; router: "app" | "pages" } | null> {
  const raw = await readTextIfExists(path.join(dir, "package.json"));
  if (!raw) return null;
  let pkg: { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!pkg.dependencies?.next && !pkg.devDependencies?.next) return null;
  const name = pkg.name || path.basename(dir);
  for (const candidate of ["app", "src/app"]) if (await isDirectory(path.join(dir, candidate))) return { name, router: "app" };
  for (const candidate of ["pages", "src/pages"]) if (await isDirectory(path.join(dir, candidate))) return { name, router: "pages" };
  return null;
}

async function isDirectory(p: string): Promise<boolean> {
  return fs.stat(p).then((s) => s.isDirectory()).catch(() => false);
}
