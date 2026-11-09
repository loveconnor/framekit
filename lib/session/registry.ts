import { ProjectSession } from "./session";
import { validateProject } from "@/lib/project/validation";
import { rememberProject } from "@/lib/filesystem/config-store";

type Registry = { session: ProjectSession | null };

const globalRegistry = globalThis as unknown as { __framekit?: Registry };
if (!globalRegistry.__framekit) {
  globalRegistry.__framekit = { session: null };
  const cleanup = () => {
    const session = globalRegistry.__framekit?.session;
    if (session) void session.dev.stop();
  };
  process.once("exit", cleanup);
  process.once("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
}

export function currentSession(): ProjectSession | null {
  return globalRegistry.__framekit!.session;
}

export async function openProject(inputPath: string, editorOrigin: string): Promise<ProjectSession> {
  const project = await validateProject(inputPath);
  const existing = globalRegistry.__framekit!.session;
  if (existing) await existing.close();
  const session = new ProjectSession(project, editorOrigin);
  globalRegistry.__framekit!.session = session;
  await rememberProject({ path: project.root, name: project.name });
  void session.boot();
  return session;
}

export async function closeProject(): Promise<void> {
  const existing = globalRegistry.__framekit!.session;
  globalRegistry.__framekit!.session = null;
  if (existing) await existing.close();
}
