import { z } from "zod";
import fs from "node:fs/promises";
import { readConfig, writeConfig, forgetProject, updateRecentProject } from "@/lib/filesystem/config-store";
import { assertLocalRequest, assertNotHosted, errorResponse, json } from "@/lib/session/http";

export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    const config = await readConfig();
    // Drop projects whose folders are gone so the picker never offers a dead path.
    const existing = [];
    for (const entry of config.recentProjects) {
      if (await fs.stat(entry.path).then((s) => s.isDirectory()).catch(() => false)) existing.push(entry);
    }
    if (existing.length !== config.recentProjects.length) await writeConfig({ ...config, recentProjects: existing });
    return json({ recent: existing });
  } catch (error) {
    return errorResponse(error);
  }
}

const Patch = z.object({
  path: z.string(),
  lastRoute: z.string().optional(),
  lastViewport: z.enum(["desktop", "tablet", "mobile"]).optional(),
});

export async function PATCH(request: Request) {
  try {
    assertLocalRequest(request);
    const { path, ...patch } = Patch.parse(await request.json());
    await updateRecentProject(path, patch);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertLocalRequest(request);
    assertNotHosted();
    const { path } = z.object({ path: z.string() }).parse(await request.json());
    await forgetProject(path);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
