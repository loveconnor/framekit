import { currentSession } from "@/lib/session/registry";
import { assertLocalRequest, errorResponse, json } from "@/lib/session/http";

export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    const session = currentSession();
    return json({ snapshot: session ? session.snapshot() : null });
  } catch (error) {
    return errorResponse(error);
  }
}
