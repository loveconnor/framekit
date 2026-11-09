import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectInfo, RouteInfo } from "@/types/project";
import { toPosix } from "@/lib/filesystem/paths";

const PAGE_FILE = /^page\.(tsx|jsx|js|ts)$/;

/**
 * Walk the App Router directory and list routable pages.
 * Route groups `(name)` are dropped from the URL, `_private` folders and `@slots`
 * are skipped, and intercepting folders `(.)x` are not public routes.
 */
export async function discoverRoutes(project: ProjectInfo): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];

  async function walk(dir: string, segments: string[]): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && PAGE_FILE.test(entry.name)) {
        const pattern = "/" + segments.join("/");
        routes.push({
          pattern: pattern === "/" ? "/" : pattern.replace(/\/$/, ""),
          name: routeName(segments),
          file: toPosix(path.relative(project.root, full)),
          dynamic: segments.some((s) => s.startsWith("[")),
        });
        continue;
      }
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name.startsWith("_") || name.startsWith("@") || name === "node_modules") continue;
      if (/^\(\.{1,3}\)/.test(name)) continue; // intercepting route
      if (/^\(.+\)$/.test(name)) {
        await walk(full, segments); // route group: no URL segment
        continue;
      }
      await walk(full, [...segments, name]);
    }
  }

  await walk(project.appDir, []);
  routes.sort((a, b) => {
    if (a.pattern === "/") return -1;
    if (b.pattern === "/") return 1;
    if (a.dynamic !== b.dynamic) return a.dynamic ? 1 : -1;
    return a.pattern.localeCompare(b.pattern);
  });
  return routes;
}

function routeName(all: string[]): string {
  // A leading dynamic segment is usually a locale or tenant prefix (`/[locale]/privacy`): name the
  // page after what follows it, so `/[locale]` is Home and not "Locale Locale".
  let start = 0;
  while (start < all.length && /^\[(locale|lang|language|lng|country|region|market|tenant|site|domain)\]$/i.test(all[start])) start++;
  const segments = all.slice(start);
  if (segments.length === 0) return "Home";
  const last = segments[segments.length - 1];
  const dynamicMatch = last.match(/^\[{1,2}(?:\.\.\.)?(.+?)\]{1,2}$/);
  const base = dynamicMatch ? `${humanize(segments[segments.length - 2] ?? dynamicMatch[1])} ${humanize(dynamicMatch[1])}` : humanize(last);
  return base;
}

function humanize(segment: string): string {
  return segment
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
