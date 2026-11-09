import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

/** Framekit keeps everything it owns under ~/.framekit so imported projects stay untouched. */
export function framekitHome(): string {
  return process.env.FRAMEKIT_HOME ?? path.join(os.homedir(), ".framekit");
}

export function workspacesDir(): string {
  return path.join(framekitHome(), "workspaces");
}

export function backupsDir(): string {
  return path.join(framekitHome(), "backups");
}

export function configFile(): string {
  return path.join(framekitHome(), "config.json");
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export function shortHash(input: string, length = 8): string {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, length);
}

export function contentHash(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex");
}

/**
 * Resolve `relative` inside `root` and refuse anything that escapes it.
 * Symlinks are resolved so a link pointing outside the root is rejected too.
 */
export async function resolveInside(root: string, relative: string): Promise<string> {
  const realRoot = await fs.realpath(root);
  const candidate = path.resolve(realRoot, relative);
  if (!isInside(realRoot, candidate)) {
    throw new Error(`Path escapes project root: ${relative}`);
  }
  // Resolve the deepest existing ancestor so symlinked directories are checked.
  let probe = candidate;
  while (true) {
    try {
      const real = await fs.realpath(probe);
      const rest = path.relative(probe, candidate);
      const resolved = rest ? path.join(real, rest) : real;
      if (!isInside(realRoot, resolved)) {
        throw new Error(`Path escapes project root through a symlink: ${relative}`);
      }
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(probe);
      if (parent === probe) return candidate;
      probe = parent;
    }
  }
}

export function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
