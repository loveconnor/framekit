import type { EditCommand } from "@/lib/commands/schema";
import type { CommandResult, SessionSnapshot } from "@/lib/session/session";
import type { RouteInfo, ProjectValidationError } from "@/types/project";
import type { RecentProject } from "@/lib/filesystem/config-store";
import type { FoundApp } from "@/lib/project/find-apps";
import type { PublishResult, PublishStatus } from "@/lib/project/publish";
import type { TextSourceMatch } from "@/lib/source/text-sources";

export class ApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number, public readonly info?: ProjectValidationError) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } & Partial<ProjectValidationError> };
  if (!response.ok) {
    const error = body.error ?? {};
    throw new ApiError(error.message ?? response.statusText, error.code ?? "ERROR", response.status, error.code && "message" in error ? (error as ProjectValidationError) : undefined);
  }
  return body as T;
}

export const api = {
  openProject: (path: string) => request<{ ok: true; snapshot: SessionSnapshot }>("/api/projects/open", { method: "POST", body: JSON.stringify({ path }) }),
  browseFolder: (startIn?: string) => request<{ path: string | null }>("/api/projects/browse", { method: "POST", body: JSON.stringify({ startIn }) }),
  findApps: (path: string) => request<{ apps: FoundApp[] }>("/api/projects/find", { method: "POST", body: JSON.stringify({ path }) }),
  publishStatus: () => request<{ status: PublishStatus; defaultMessage: string; unsavedEdits: boolean; hosted: boolean }>("/api/publish"),
  publish: (message: string) => request<PublishResult>("/api/publish", { method: "POST", body: JSON.stringify({ message }) }),
  textSource: (texts: string[]) => request<{ matches: TextSourceMatch[] }>("/api/text-source", { method: "POST", body: JSON.stringify({ texts }) }),
  closeProject: () => request<{ ok: true }>("/api/projects/close", { method: "POST" }),
  current: () => request<{ snapshot: SessionSnapshot | null }>("/api/projects/current"),
  routes: () => request<{ routes: RouteInfo[] }>("/api/projects/routes"),
  recent: () => request<{ recent: RecentProject[] }>("/api/projects/recent"),
  rememberRoute: (path: string, patch: { lastRoute?: string; lastViewport?: "desktop" | "tablet" | "mobile" }) =>
    request<{ ok: true }>("/api/projects/recent", { method: "PATCH", body: JSON.stringify({ path, ...patch }) }),
  forgetRecent: (path: string) => request<{ ok: true }>("/api/projects/recent", { method: "DELETE", body: JSON.stringify({ path }) }),
  command: (command: EditCommand, expectedRevision?: number, groupKey?: string) =>
    request<CommandResult>("/api/commands", { method: "POST", body: JSON.stringify({ command, expectedRevision, groupKey }) }),
  undo: () => request<CommandResult>("/api/commands/undo", { method: "POST" }),
  redo: () => request<CommandResult>("/api/commands/redo", { method: "POST" }),
  save: () => request<{ files: string[]; backupDir: string | null; isDirty: boolean; dirtyFiles: string[] }>("/api/save", { method: "POST" }),
  assets: () => request<{ images: string[] }>("/api/assets"),
  upload: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/assets/upload", { method: "POST", body: form });
    const body = (await response.json()) as { src?: string; error?: { message: string; code: string } };
    if (!response.ok || !body.src) throw new ApiError(body.error?.message ?? "Upload failed", body.error?.code ?? "ERROR", response.status);
    return body.src;
  },
};
