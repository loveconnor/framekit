import { currentSession } from "@/lib/session/registry";
import { assertLocalRequest, errorResponse, json } from "@/lib/session/http";
import { SessionError } from "@/lib/session/session";

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const session = currentSession();
    if (!session) throw new SessionError("No project is open.", "NO_PROJECT", 404);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new SessionError("No file was uploaded.", "INVALID_REQUEST");
    if (file.size > MAX_BYTES) throw new SessionError("Images must be smaller than 25 MB.", "INVALID_REQUEST");
    const bytes = Buffer.from(await file.arrayBuffer());
    const src = await session.addAsset(file.name, bytes);
    return json({ src });
  } catch (error) {
    return errorResponse(error);
  }
}
