import { currentSession } from "@/lib/session/registry";
import { assertLocalRequest, errorResponse, json } from "@/lib/session/http";
import { SessionError } from "@/lib/session/session";

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const session = currentSession();
    if (!session) throw new SessionError("No project is open.", "NO_PROJECT", 404);
    const result = await session.save();
    return json({ ...result, isDirty: session.isDirty, dirtyFiles: session.dirtyFiles });
  } catch (error) {
    return errorResponse(error);
  }
}
