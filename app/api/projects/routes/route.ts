import { currentSession } from "@/lib/session/registry";
import { assertLocalRequest, errorResponse, json } from "@/lib/session/http";
import { SessionError } from "@/lib/session/session";

export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    const session = currentSession();
    if (!session) throw new SessionError("No project is open.", "NO_PROJECT", 404);
    return json({ routes: await session.refreshRoutes() });
  } catch (error) {
    return errorResponse(error);
  }
}
