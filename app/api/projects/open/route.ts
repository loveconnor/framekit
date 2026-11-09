import { z } from "zod";
import fs from "node:fs/promises";
import { openProject } from "@/lib/session/registry";
import { hostedConfig } from "@/lib/hosted/config";
import { SessionError } from "@/lib/session/session";
import { assertLocalRequest, editorOriginFrom, errorResponse, json } from "@/lib/session/http";

const Body = z.object({ path: z.string().min(1).max(2000) });

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const { path } = Body.parse(await request.json());
    // Hosted Framekit edits one site; opening anything else would run arbitrary code on the server.
    const hosted = hostedConfig();
    if (hosted && !(await samePath(path, hosted.projectRoot))) throw new SessionError("This editor only opens its own site.", "FORBIDDEN", 403);
    const session = await openProject(path, editorOriginFrom(request));
    return json({ ok: true, snapshot: session.snapshot() });
  } catch (error) {
    return errorResponse(error);
  }
}

async function samePath(a: string, b: string): Promise<boolean> {
  const real = (p: string) => fs.realpath(p).catch(() => p);
  return (await real(a)) === (await real(b));
}
