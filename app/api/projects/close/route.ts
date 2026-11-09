import { closeProject } from "@/lib/session/registry";
import { assertLocalRequest, assertNotHosted, errorResponse, json } from "@/lib/session/http";

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    assertNotHosted();
    await closeProject();
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
