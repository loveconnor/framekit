import { z } from "zod";
import { openProject } from "@/lib/session/registry";
import { assertLocalRequest, editorOriginFrom, errorResponse, json } from "@/lib/session/http";

const Body = z.object({ path: z.string().min(1).max(2000) });

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const { path } = Body.parse(await request.json());
    const session = await openProject(path, editorOriginFrom(request));
    return json({ ok: true, snapshot: session.snapshot() });
  } catch (error) {
    return errorResponse(error);
  }
}
