import fs from "node:fs/promises";
import path from "node:path";
import { EXCLUDED_DIRS, SOURCE_EXTENSIONS } from "@/lib/preview/workspace";

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;
const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".json", ".css"];
const MAX_FILES = 500;

/**
 * Source files outside the project folder that the project imports by relative path
 * (e.g. `../../../shared/legal.ts` in a repo that shares code without npm workspaces),
 * followed transitively. The preview copy needs them at the same relative location.
 * Returns absolute paths; empty when the project is self-contained.
 */
export async function findSharedFiles(root: string): Promise<string[]> {
  const outside = new Set<string>();
  const queue: string[] = [];

  const scan = async (file: string) => {
    let content: string;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      return;
    }
    for (const match of content.matchAll(SPECIFIER)) {
      const spec = match[1];
      if (!spec.startsWith(".")) continue;
      const target = await resolveFile(path.resolve(path.dirname(file), spec));
      if (!target || isInside(root, target) || outside.has(target) || outside.size >= MAX_FILES) continue;
      outside.add(target);
      queue.push(target);
    }
  };

  const walk = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) await scan(full);
    }
  };

  await walk(root);
  while (queue.length) await scan(queue.shift()!);
  return [...outside].sort();
}

/** The deepest directory containing every path. */
export function commonAncestor(paths: string[]): string {
  let common = paths[0];
  for (const p of paths.slice(1)) {
    while (!isInside(common, p)) common = path.dirname(common);
  }
  return common;
}

function isInside(dir: string, file: string): boolean {
  const rel = path.relative(dir, file);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function resolveFile(base: string): Promise<string | null> {
  // TypeScript ESM style: `./x.js` written for a file that is really `./x.ts`.
  const stem = base.replace(/\.(c|m)?jsx?$/, "");
  const candidates = [base, ...(stem !== base ? RESOLVE_EXTENSIONS.map((e) => stem + e) : []), ...RESOLVE_EXTENSIONS.map((e) => base + e), ...RESOLVE_EXTENSIONS.map((e) => path.join(base, `index${e}`))];
  for (const candidate of candidates) {
    if (await fs.stat(candidate).then((s) => s.isFile()).catch(() => false)) return candidate;
  }
  return null;
}
