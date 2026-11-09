import fs from "node:fs/promises";
import path from "node:path";
import { ProjectError, type PackageManager, type ProjectInfo } from "@/types/project";
import { fileExists, readTextIfExists } from "@/lib/filesystem/safe-write";
import { toPosix } from "@/lib/filesystem/paths";
import { commonAncestor, findSharedFiles } from "@/lib/project/shared-files";

const LAYOUT_EXTENSIONS = ["tsx", "jsx", "js", "ts"];

export async function detectPackageManager(root: string): Promise<PackageManager> {
  if (await fileExists(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (await fileExists(path.join(root, "yarn.lock"))) return "yarn";
  if (await fileExists(path.join(root, "bun.lock"))) return "bun";
  if (await fileExists(path.join(root, "bun.lockb"))) return "bun";
  return "npm";
}

export function installCommand(pm: PackageManager): string {
  return pm === "yarn" ? "yarn" : `${pm} install`;
}

/**
 * Check that `inputPath` is a supported single-package Next.js App Router project.
 * Throws ProjectError with a specific code for every failure the UI needs to explain.
 */
export async function validateProject(inputPath: string): Promise<ProjectInfo> {
  const expanded = inputPath.replace(/^~(?=$|\/)/, process.env.HOME ?? "");
  const resolved = path.resolve(expanded);

  let root: string;
  try {
    root = await fs.realpath(resolved);
  } catch {
    throw new ProjectError({
      code: "NOT_FOUND",
      message: "That directory doesn't exist.",
      detail: resolved,
    });
  }

  try {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) {
      throw new ProjectError({ code: "NOT_FOUND", message: "That path is a file, not a directory.", detail: root });
    }
    await fs.access(root, fs.constants.R_OK);
  } catch (error) {
    if (error instanceof ProjectError) throw error;
    throw new ProjectError({ code: "NOT_READABLE", message: "That directory can't be read.", detail: root });
  }

  const pkgRaw = await readTextIfExists(path.join(root, "package.json"));
  if (pkgRaw === null) {
    throw new ProjectError({
      code: "NO_PACKAGE_JSON",
      message: "No package.json found. Open the folder that contains the Next.js app.",
      detail: root,
    });
  }

  let pkg: { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; workspaces?: unknown };
  try {
    pkg = JSON.parse(pkgRaw);
  } catch (error) {
    throw new ProjectError({
      code: "NO_PACKAGE_JSON",
      message: "package.json could not be parsed.",
      detail: (error as Error).message,
    });
  }

  if (pkg.workspaces || (await fileExists(path.join(root, "pnpm-workspace.yaml")))) {
    throw new ProjectError({
      code: "MONOREPO",
      message: "This is a monorepo root. Pick one of its Next.js apps.",
      detail: root,
    });
  }

  const nextVersion = pkg.dependencies?.next ?? pkg.devDependencies?.next;
  if (!nextVersion) {
    throw new ProjectError({
      code: "NOT_NEXT",
      message: "This project doesn't depend on Next.js.",
      detail: `No "next" entry in package.json dependencies at ${root}`,
    });
  }

  let appDirRelative: string | null = null;
  for (const candidate of ["app", "src/app"]) {
    if (await isDirectory(path.join(root, candidate))) {
      appDirRelative = candidate;
      break;
    }
  }

  if (!appDirRelative) {
    const hasPages = (await isDirectory(path.join(root, "pages"))) || (await isDirectory(path.join(root, "src/pages")));
    if (hasPages) {
      throw new ProjectError({
        code: "PAGES_ROUTER",
        message: "This project uses the Pages Router. Framekit supports the App Router only.",
      });
    }
    throw new ProjectError({
      code: "NO_APP_DIR",
      message: "No app/ or src/app/ directory found.",
      detail: root,
    });
  }

  const appDir = path.join(root, appDirRelative);
  const sourceRoot = path.dirname(appDir);

  let rootLayoutFile: string | null = null;
  for (const ext of LAYOUT_EXTENSIONS) {
    const candidate = path.join(appDir, `layout.${ext}`);
    if (await fileExists(candidate)) {
      rootLayoutFile = toPosix(path.relative(root, candidate));
      break;
    }
  }
  // Apps with several root layouts (or one under `[locale]`, typical for i18n) have no app/layout:
  // the root layout is the first layout below it that renders <html>.
  if (!rootLayoutFile) {
    const nested = await findNestedRootLayout(appDir);
    if (nested) rootLayoutFile = toPosix(path.relative(root, nested));
  }
  if (!rootLayoutFile) {
    throw new ProjectError({
      code: "NO_ROOT_LAYOUT",
      message: "No root layout found in the app directory.",
      detail: `Expected ${appDirRelative}/layout.tsx`,
    });
  }

  const workspaceRoot = await findRepoRoot(root);
  let repoRoot = workspaceRoot;
  let repoKind: ProjectInfo["repoKind"] = workspaceRoot ? "workspace" : null;
  let sharedFiles: string[] = [];
  if (!workspaceRoot) {
    const shared = await findSharedFiles(root);
    if (shared.length) {
      repoRoot = commonAncestor([root, ...shared]);
      repoKind = "shared-files";
      sharedFiles = shared.map((f) => toPosix(path.relative(repoRoot!, f)));
    }
  }
  const packageManager = await detectPackageManager(workspaceRoot ?? root);

  // Workspaces usually hoist dependencies, so `next` may be installed anywhere up to the repo root.
  let nextInstalled = false;
  for (let dir = root; ; dir = path.dirname(dir)) {
    if (await fileExists(path.join(dir, "node_modules", "next", "package.json"))) {
      nextInstalled = true;
      break;
    }
    if (!repoRoot || dir === repoRoot || dir === path.dirname(dir)) break;
  }
  if (!nextInstalled) {
    throw new ProjectError({
      code: "MISSING_DEPENDENCIES",
      message: "Project dependencies are missing.",
      suggestion: installCommand(packageManager),
      detail: `node_modules/next was not found in ${repoRoot ?? root}`,
    });
  }

  return {
    root,
    name: pkg.name || path.basename(root),
    sourceRoot,
    appDir,
    appDirRelative,
    packageManager,
    nextVersion,
    rootLayoutFile,
    repoRoot,
    repoKind,
    sharedFiles,
  };
}

/** True when `dir` is the root of an npm/yarn/bun or pnpm workspace. */
export async function isWorkspaceRoot(dir: string): Promise<boolean> {
  if (await fileExists(path.join(dir, "pnpm-workspace.yaml"))) return true;
  const raw = await readTextIfExists(path.join(dir, "package.json"));
  if (!raw) return false;
  try {
    return Boolean((JSON.parse(raw) as { workspaces?: unknown }).workspaces);
  } catch {
    return false;
  }
}

/** The nearest workspace root above `root`, if the project is a package inside a monorepo. */
async function findRepoRoot(root: string): Promise<string | null> {
  for (let dir = path.dirname(root); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    if (await isWorkspaceRoot(dir)) return dir;
  }
  return null;
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Breadth-first search for the shallowest `layout.*` under the app dir that renders <html>.
 * Only walks segments that can hold a root layout (route groups, dynamic and static segments),
 * skipping private folders, parallel slots and intercepting routes.
 */
async function findNestedRootLayout(appDir: string): Promise<string | null> {
  let level = [appDir];
  for (let depth = 0; depth < 4 && level.length; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      if (dir !== appDir) {
        for (const ext of LAYOUT_EXTENSIONS) {
          const candidate = path.join(dir, `layout.${ext}`);
          const content = await readTextIfExists(candidate);
          if (content && /<html[\s>]/.test(content)) return candidate;
        }
      }
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory() || /^[_@.]/.test(entry.name) || /^\(\.{1,3}\)/.test(entry.name) || entry.name === "node_modules") continue;
        next.push(path.join(dir, entry.name));
      }
    }
    level = next.sort();
  }
  return null;
}
