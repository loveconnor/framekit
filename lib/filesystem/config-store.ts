import fs from "node:fs/promises";
import { configFile, ensureDir, framekitHome } from "./paths";
import { atomicWrite } from "./safe-write";

export type RecentProject = {
  path: string;
  name: string;
  lastOpened: string;
  lastRoute?: string;
  lastViewport?: "desktop" | "tablet" | "mobile";
};

export type FramekitConfig = {
  recentProjects: RecentProject[];
  /** Per project root: files Framekit has saved that haven't been published (committed) yet, project-relative. */
  pendingPublish: Record<string, string[]>;
};

export async function readConfig(): Promise<FramekitConfig> {
  try {
    const raw = await fs.readFile(configFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<FramekitConfig>;
    return {
      recentProjects: Array.isArray(parsed.recentProjects) ? parsed.recentProjects : [],
      pendingPublish: parsed.pendingPublish && typeof parsed.pendingPublish === "object" ? parsed.pendingPublish : {},
    };
  } catch {
    return { recentProjects: [], pendingPublish: {} };
  }
}

export async function writeConfig(config: FramekitConfig): Promise<void> {
  await ensureDir(framekitHome());
  await atomicWrite(configFile(), JSON.stringify(config, null, 2));
}

export async function rememberProject(entry: Omit<RecentProject, "lastOpened">): Promise<void> {
  const config = await readConfig();
  const others = config.recentProjects.filter((p) => p.path !== entry.path);
  const existing = config.recentProjects.find((p) => p.path === entry.path);
  config.recentProjects = [
    { ...existing, ...entry, lastOpened: new Date().toISOString() },
    ...others,
  ].slice(0, 12);
  await writeConfig(config);
}

export async function updateRecentProject(
  projectPath: string,
  patch: Partial<Pick<RecentProject, "lastRoute" | "lastViewport">>,
): Promise<void> {
  const config = await readConfig();
  const entry = config.recentProjects.find((p) => p.path === projectPath);
  if (!entry) return;
  Object.assign(entry, patch);
  await writeConfig(config);
}

export async function forgetProject(projectPath: string): Promise<void> {
  const config = await readConfig();
  config.recentProjects = config.recentProjects.filter((p) => p.path !== projectPath);
  await writeConfig(config);
}

export async function getPendingPublish(projectRoot: string): Promise<string[]> {
  return (await readConfig()).pendingPublish[projectRoot] ?? [];
}

export async function addPendingPublish(projectRoot: string, files: string[]): Promise<void> {
  if (!files.length) return;
  const config = await readConfig();
  config.pendingPublish[projectRoot] = [...new Set([...(config.pendingPublish[projectRoot] ?? []), ...files])].sort();
  await writeConfig(config);
}

export async function clearPendingPublish(projectRoot: string, files: string[]): Promise<void> {
  const config = await readConfig();
  const remaining = (config.pendingPublish[projectRoot] ?? []).filter((f) => !files.includes(f));
  if (remaining.length) config.pendingPublish[projectRoot] = remaining;
  else delete config.pendingPublish[projectRoot];
  await writeConfig(config);
}
