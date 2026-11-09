import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import type { ProjectInfo } from "@/types/project";
import { hostedConfig } from "@/lib/hosted/config";
import { ensureDir, shortHash, toPosix, workspacesDir } from "@/lib/filesystem/paths";
import { atomicWrite, fileExists, readTextIfExists } from "@/lib/filesystem/safe-write";

export const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", ".next", "out", "dist", "build", "coverage", ".turbo", ".vercel", ".framekit", ".cache", ".idea", ".vscode",
]);

export const SOURCE_EXTENSIONS = new Set([".tsx", ".jsx", ".js", ".ts", ".mjs", ".cjs", ".mts", ".cts"]);

const DEPS_STAMP = ".framekit-deps";
const CONFIG_CANDIDATES = ["next.config.ts", "next.config.mts", "next.config.mjs", "next.config.js", "next.config.cjs"];

/**
 * The isolated copy of a project that the preview server runs from.
 * Source files in it are instrumented; node_modules is cloned from the real install.
 *
 * For an app inside a monorepo the copy mirrors the whole repo (`mirrorRoot`) with the app at its
 * real relative path (`dir`), so hoisted dependencies and sibling workspace packages still resolve.
 */
export class Workspace {
  readonly dir: string;
  /** Top of the copy: the mirrored repo root for a monorepo app, else the same as `dir`. */
  readonly mirrorRoot: string;
  /** What `mirrorRoot` mirrors: the monorepo root, else the project root. */
  private readonly sourceRoot: string;

  constructor(readonly project: ProjectInfo) {
    this.sourceRoot = project.repoRoot ?? project.root;
    this.mirrorRoot = path.join(workspacesDir(), `${sanitize(project.name)}-${shortHash(project.root)}`);
    this.dir = path.join(this.mirrorRoot, path.relative(this.sourceRoot, project.root));
  }

  /** List every project file (relative posix paths) that should exist in the workspace. */
  async listProjectFiles(): Promise<string[]> {
    const files: string[] = [];
    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith(".framekit")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) {
          const stat = await fs.stat(full).catch(() => null);
          if (!stat || stat.isDirectory()) continue;
          files.push(toPosix(path.relative(this.project.root, full)));
          continue;
        }
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) files.push(toPosix(path.relative(this.project.root, full)));
      }
    };
    await walk(this.project.root);
    return files;
  }

  /**
   * Build the workspace. `transform` returns the instrumented content for a source file, or null
   * to copy it verbatim. node_modules is cloned (copy-on-write on APFS/btrfs) so Turbopack sees an
   * ordinary project with its dependencies inside the root.
   */
  async create(
    transform: (relativeFile: string, content: string) => Promise<string | null>,
    editorOrigin: string,
  ): Promise<void> {
    void editorOrigin;
    const reuseDeps = await this.canReuseDependencies();
    if (reuseDeps) await clearExceptDependencies(this.mirrorRoot);
    else await fs.rm(this.mirrorRoot, { recursive: true, force: true });
    await ensureDir(this.dir);

    // Monorepo: everything outside the app is copied verbatim (sibling packages, root configs).
    if (this.project.repoKind === "workspace") await this.copyRepoOutsideApp();
    // Shared-files: only the handful of outside files the app imports, at their real relative paths.
    if (this.project.repoKind === "shared-files") {
      for (const rel of this.project.sharedFiles) {
        const target = path.join(this.mirrorRoot, rel);
        await ensureDir(path.dirname(target));
        await fs.copyFile(path.join(this.sourceRoot, rel), target);
      }
    }

    const files = await this.listProjectFiles();
    for (const rel of files) {
      const source = path.join(this.project.root, rel);
      const target = path.join(this.dir, rel);
      await ensureDir(path.dirname(target));
      const ext = path.extname(rel);
      if (SOURCE_EXTENSIONS.has(ext)) {
        const content = await fs.readFile(source, "utf8");
        const transformed = await transform(rel, content);
        await fs.writeFile(target, transformed ?? content);
      } else {
        await fs.copyFile(source, target);
      }
    }

    if (!reuseDeps) await this.cloneDependencies();
    await this.wrapConfig();
  }

  /**
   * Wrap the project's next.config so the preview hides Next's dev indicator. The project's own
   * config is kept beside it and loaded first; everything else passes through unchanged.
   */
  private async wrapConfig(): Promise<void> {
    let userConfig: string | null = null;
    for (const candidate of CONFIG_CANDIDATES) {
      if (await fileExists(path.join(this.dir, candidate))) {
        userConfig = candidate;
        break;
      }
    }
    const pkg = JSON.parse((await readTextIfExists(path.join(this.project.root, "package.json"))) ?? "{}") as { type?: string };
    const esmPackage = pkg.type === "module";
    // Next compares this against real paths, so resolve symlinks (e.g. macOS /var -> /private/var).
    const turbopackRoot = await fs.realpath(this.mirrorRoot);
    // The editor shows the preview in an iframe, so anti-framing headers (X-Frame-Options,
    // CSP frame-ancestors) are dropped from the preview only. The real project keeps them.
    // Hosted: the preview is opened from its public URL, which Next's dev server must accept as an
    // origin, or it refuses live-reload connections and dev assets.
    const hosted = hostedConfig();
    const devOrigins = hosted ? [new URL(hosted.previewPublicUrl).hostname, "*.vercel.run"] : [];
    const mergeFn = `function framekitAllowFraming(rules) {
  return (rules || []).map((rule) => ({
    ...rule,
    headers: (rule.headers || [])
      .filter((h) => String(h.key).toLowerCase() !== "x-frame-options")
      .map((h) => String(h.key).toLowerCase() === "content-security-policy"
        ? { ...h, value: String(h.value).replace(/frame-ancestors[^;]*/gi, "frame-ancestors *") }
        : h),
  })).filter((rule) => rule.headers.length > 0);
}
function framekitMerge(user) {
  const userHeaders = user.headers;
  return {
    ...user,
    devIndicators: false,
    ...(${JSON.stringify(devOrigins)}.length ? { allowedDevOrigins: [...(user.allowedDevOrigins || []), ...${JSON.stringify(devOrigins)}] } : {}),
    turbopack: { ...(user.turbopack || {}), root: ${JSON.stringify(turbopackRoot)} },
    ...(typeof userHeaders === "function" ? { headers: async () => framekitAllowFraming(await userHeaders.call(user)) } : {}),
  };
}`;
    if (!userConfig) {
      await atomicWrite(path.join(this.dir, "next.config.mjs"), `// Generated by Framekit for the preview workspace.\n${mergeFn}\nexport default framekitMerge({});\n`);
      return;
    }
    const ext = path.extname(userConfig);
    const renamed = `framekit.user.config${ext}`;
    await fs.rename(path.join(this.dir, userConfig), path.join(this.dir, renamed));
    const isCjs = ext === ".cjs" || (ext === ".js" && !esmPackage);
    const wrapper = isCjs
      ? `// Generated by Framekit for the preview workspace. The project's own config is in ${renamed}.
const userModule = require("./${renamed}");
${mergeFn}
module.exports = async (phase, context) => {
  let user = userModule && userModule.__esModule ? userModule.default : userModule;
  if (typeof user === "function") user = await user(phase, context);
  return framekitMerge(user || {});
};
`
      : `// Generated by Framekit for the preview workspace. The project's own config is in ${renamed}.
import userConfig from "./${renamed}";
${mergeFn}
const framekitConfig = async (phase, context) => {
  let user = userConfig;
  if (typeof user === "function") user = await user(phase, context);
  return framekitMerge(user || {});
};
export default framekitConfig;
`;
    await atomicWrite(path.join(this.dir, userConfig), wrapper);
  }

  /** Copy every repo file outside the app (and outside node_modules) into the mirror, unmodified. */
  private async copyRepoOutsideApp(): Promise<void> {
    const walk = async (dir: string) => {
      if (dir === this.project.root) return;
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith(".framekit")) continue;
        const full = path.join(dir, entry.name);
        const stat = entry.isSymbolicLink() ? await fs.stat(full).catch(() => null) : null;
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile() || stat?.isFile()) {
          const target = path.join(this.mirrorRoot, path.relative(this.sourceRoot, full));
          await ensureDir(path.dirname(target));
          await fs.copyFile(full, target);
        }
      }
    };
    await walk(this.sourceRoot);
  }

  /** Every node_modules directory in the mirrored tree, relative to `sourceRoot`. */
  private async dependencyDirs(): Promise<string[]> {
    const dirs: string[] = [];
    if (this.project.repoKind !== "workspace") {
      // Only what Node's resolution from the app can reach: its own node_modules and its ancestors'.
      for (let dir = this.project.root; ; dir = path.dirname(dir)) {
        const candidate = path.join(dir, "node_modules");
        if (await fs.lstat(candidate).then(() => true, () => false)) dirs.push(path.relative(this.sourceRoot, candidate));
        if (dir === this.sourceRoot || dir === path.dirname(dir)) break;
      }
      return dirs;
    }
    const walk = async (dir: string, depth: number) => {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.name === "node_modules") {
          if (entry.isDirectory() || entry.isSymbolicLink()) dirs.push(path.relative(this.sourceRoot, full));
          continue;
        }
        if (!entry.isDirectory() || EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        if (depth < 4) await walk(full, depth + 1);
      }
    };
    await walk(this.sourceRoot, 0);
    return dirs;
  }

  private async dependencyStamp(): Promise<string> {
    const parts: string[] = [];
    for (const lock of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"]) {
      const stat = await fs.stat(path.join(this.project.repoKind === "workspace" ? this.sourceRoot : this.project.root, lock)).catch(() => null);
      if (stat) parts.push(`${lock}:${stat.size}:${stat.mtimeMs}`);
    }
    for (const rel of await this.dependencyDirs()) {
      const modules = await fs.stat(path.join(this.sourceRoot, rel)).catch(() => null);
      if (modules) parts.push(`${rel}:${modules.mtimeMs}`);
    }
    const hidden = await fs.stat(path.join(this.sourceRoot, "node_modules", ".package-lock.json")).catch(() => null);
    if (hidden) parts.push(`.package-lock:${hidden.size}:${hidden.mtimeMs}`);
    return parts.join("|");
  }

  private async canReuseDependencies(): Promise<boolean> {
    const stamp = await readTextIfExists(path.join(this.mirrorRoot, DEPS_STAMP));
    if (!stamp) return false;
    if (!(await resolveNextPackage(this.dir, this.mirrorRoot))) return false;
    return stamp === (await this.dependencyStamp());
  }

  /** Clone every node_modules into the workspace with copy-on-write where the filesystem supports it. */
  private async cloneDependencies(): Promise<void> {
    for (const rel of await this.dependencyDirs()) {
      const source = await fs.realpath(path.join(this.sourceRoot, rel)).catch(() => null);
      if (!source) continue;
      const target = path.join(this.mirrorRoot, rel);
      await fs.rm(target, { recursive: true, force: true });
      await ensureDir(path.dirname(target));
      const args = process.platform === "darwin" ? ["-Rc", source, target] : ["-R", "--reflink=auto", source, target];
      await new Promise<void>((resolve, reject) => {
        execFile("cp", args, { maxBuffer: 1024 * 1024 }, (error, _stdout, stderr) => {
          if (error) reject(new Error(`Could not copy ${rel} into the preview workspace: ${stderr || error.message}`));
          else resolve();
        });
      });
    }
    await atomicWrite(path.join(this.mirrorRoot, DEPS_STAMP), await this.dependencyStamp());
  }

  async writeFile(relative: string, content: string | Buffer): Promise<void> {
    await atomicWrite(path.join(this.dir, relative), content);
  }

  async removeFile(relative: string): Promise<void> {
    await fs.rm(path.join(this.dir, relative), { force: true });
  }

  async destroy(): Promise<void> {
    await fs.rm(this.mirrorRoot, { recursive: true, force: true });
  }
}

/** Find the `next` package for `dir`, looking upward no further than `stopAt` (hoisted installs). */
export async function resolveNextPackage(dir: string, stopAt: string): Promise<string | null> {
  for (let current = dir; ; current = path.dirname(current)) {
    const candidate = path.join(current, "node_modules", "next");
    if (await fileExists(path.join(candidate, "package.json"))) return candidate;
    if (current === stopAt || current === path.dirname(current)) return null;
  }
}

/** Remove everything under `dir` except node_modules directories and the deps stamp. */
async function clearExceptDependencies(dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === DEPS_STAMP) continue;
    // Keep the dev server's compile cache: it validates against file contents, and without it every
    // reopen (and every hosted wake-up) recompiles the whole site from scratch.
    if (entry.name === ".next" && entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    // Other build output and caches can be large and never hold dependencies: drop them whole.
    if (entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name)) await clearExceptDependencies(full);
    else await fs.rm(full, { recursive: true, force: true });
  }
}

function sanitize(name: string): string {
  return name.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40) || "project";
}

/**
 * The editor bridge, inlined into the preview's root layout. Read on each use (it's small, and only
 * the root layout needs it) so a changed bridge always reaches the next preview build.
 */
export function readBridgeSource(): string {
  // Framekit runs from its own repository, so the bridge source is read from the project tree.
  return readFileSync(path.join(process.cwd(), "lib", "preview", "bridge-script.js"), "utf8");
}
