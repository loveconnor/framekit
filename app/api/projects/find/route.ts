import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { findNextApps } from "@/lib/project/find-apps";
import { assertLocalRequest, assertNotHosted, errorResponse, json } from "@/lib/session/http";

const Body = z.object({ path: z.string().min(1).max(2000) });

/** List the Next.js apps inside a folder, for when the folder itself is a monorepo or a parent directory. */
export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    assertNotHosted();
    const { path: input } = Body.parse(await request.json());
    const dir = path.resolve(input.trim().replace(/^~(?=$|\/)/, os.homedir()));
    const apps = await findNextApps(dir).catch(() => []);
    return json({ apps });
  } catch (error) {
    return errorResponse(error);
  }
}
